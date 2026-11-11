"""Platform-authorized declarative agents, executed by this local gateway.

Only login and installed-package metadata reach the platform. Clinical input
is sent exclusively to the physician's configured model. No package code or
external tool is executed. Session cookies stay in process memory.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import PurePosixPath
from urllib.parse import urlsplit
from zipfile import ZipFile

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr

router = APIRouter(prefix="/api/clinvexa/platform", tags=["clinvexa-platform"])
MAX_ARCHIVE = 20 * 1024 * 1024
_client: httpx.AsyncClient | None = None
_account: dict = {}
_origin = ""
_tasks: dict[str, asyncio.Task] = {}
_connection_lock = asyncio.Lock()


def _identity() -> str:
    # IDs from different platform deployments must never share local history.
    return f"{_origin}|{_account.get('id', '')}"


class Connect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=8, max_length=500)
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr


class Invocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    installation_id: str = Field(pattern=r"^[a-fA-F0-9-]{36}$")
    text: str = Field(min_length=1, max_length=32000)
    request_id: str = Field(pattern=r"^[a-fA-F0-9-]{36}$")


def normalize_origin(value: str) -> str:
    parsed = urlsplit(value.strip())
    if (parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or not parsed.hostname):
        raise ValueError("请输入平台首页地址，不含路径、参数或账户信息")
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ValueError("远程平台需要 HTTPS；本机平台可使用 HTTP")
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


async def _get(client: httpx.AsyncClient, path: str) -> dict:
    response = await client.get(path)
    if response.status_code == 401:
        raise HTTPException(401, "平台登录已过期，请重新登录")
    if response.status_code == 404:
        raise HTTPException(404, "平台尚未升级桌面接口，或该安装授权已失效")
    if response.status_code != 200:
        raise HTTPException(502, f"平台请求未完成（{response.status_code}）")
    return response.json()


def _connection() -> httpx.AsyncClient:
    if _client is None:
        raise HTTPException(401, "请先连接医疗智能体平台")
    return _client


@router.get("/status")
async def connection_status() -> dict:
    return {"connected": _client is not None, "url": _origin,
            "display_name": _account.get("display_name", ""), "execution": "clinvexa",
            "account_id": _identity() if _client is not None else ""}


@router.post("/connect")
async def connect(payload: Connect) -> dict:
    async with _connection_lock:
        return await _connect(payload)


async def _connect(payload: Connect) -> dict:
    global _client, _origin, _account
    if any(not task.done() for task in _tasks.values()):
        raise HTTPException(409, "请先完成或停止正在运行的智能体，再切换账户")
    try:
        origin = normalize_origin(payload.url)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    candidate = httpx.AsyncClient(base_url=origin, timeout=15, follow_redirects=False)
    try:
        response = await candidate.post("/api/v1/auth/login", json={
            "email": payload.email, "password": payload.password.get_secret_value(),
        })
        if response.status_code != 200:
            raise HTTPException(401, "平台登录失败，请检查地址、账户和密码")
        if origin.startswith("http://"):
            # normalize_origin permits plaintext only on loopback. Browsers
            # accept Secure localhost cookies, but Python's cookie jar does not.
            # Adapt this in-memory loopback session without changing the server
            # cookie policy or relaxing any remote HTTPS connection.
            for cookie in candidate.cookies.jar:
                cookie.secure = False
        capabilities = await _get(candidate, "/api/v1/desktop/capabilities")
        if capabilities.get("protocol") != "clinvexa-local-v1":
            raise HTTPException(409, "平台暂不支持此版本的本机执行协议")
        account = await _get(candidate, "/api/v1/me")
        if not account.get("id"):
            raise HTTPException(502, "平台未返回有效账号，请重新登录")
    except httpx.RequestError as error:
        await candidate.aclose()
        raise HTTPException(502, "无法连接平台，请检查平台地址和网络后重试") from error
    except BaseException:
        await candidate.aclose()
        raise
    old = _client
    _client, _origin, _account = candidate, origin, account
    if old is not None:
        await old.aclose()
    return await connection_status()


@router.delete("/connect")
async def disconnect() -> dict:
    async with _connection_lock:
        return await _disconnect()


async def _disconnect() -> dict:
    global _client, _account
    if any(not task.done() for task in _tasks.values()):
        raise HTTPException(409, "请先完成或停止正在运行的智能体")
    client, account, _client, _account = _client, _account, None, {}
    if client is not None:
        try:
            await client.post("/api/v1/auth/logout", headers={
                "X-CSRF-Token": account.get("csrf_token", ""), "Origin": _origin,
            })
        except httpx.RequestError:
            pass  # Local logout still succeeds when the platform is unreachable.
        finally:
            await client.aclose()
    return {"connected": False}


@router.get("/agents")
async def installed_agents() -> dict:
    async with _connection_lock:
        return await _installed_agents()


async def _installed_agents() -> dict:
    client = _connection()
    rows, offset = [], 0
    for _ in range(100):
        page = await _get(client, f"/api/v1/desktop/agents?limit=100&offset={offset}")
        rows.extend(page.get("items", []))
        offset = page.get("next_offset")
        if offset is None:
            return {"items": rows}
    raise HTTPException(502, "平台目录分页异常，请稍后重试")


def compile_package(data: bytes, checksum: str) -> dict:
    if len(data) > MAX_ARCHIVE or hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError("智能体安装包校验失败")
    with ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 200 or sum(item.file_size for item in members) > 50 * 1024 * 1024:
            raise ValueError("智能体安装包超出大小限制")
        names = set()
        for member in members:
            name = member.filename
            path = PurePosixPath(name)
            if (path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name
                    or name.casefold() in names or (member.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("智能体安装包包含不支持的路径")
            names.add(name.casefold())
        def read(name: str, limit: int) -> str:
            if name not in archive.namelist() or archive.getinfo(name).file_size > limit:
                raise ValueError("智能体定义缺失或超出大小限制")
            return archive.read(name).decode("utf-8")
        manifest = json.loads(read("manifest.json", 1024 * 1024))
        nodes = manifest["workflow"]["nodes"]
        edges = manifest["workflow"]["edges"]
        if not 1 <= len(nodes) <= 50 or len({n["id"] for n in nodes}) != len(nodes):
            raise ValueError("智能体步骤定义无效")
        if any(n["operation"] not in {"prompt", "model", "output_schema"} for n in nodes):
            raise ValueError("此智能体需要尚未支持的工具或知识库步骤")
        if sum(n["operation"] == "model" for n in nodes) != 1:
            raise ValueError("此版本仅支持单模型工作流")
        by_id = {n["id"]: n for n in nodes}
        incoming = {key: set() for key in by_id}
        for edge in edges:
            if edge["from"] not in by_id or edge["to"] not in by_id:
                raise ValueError("智能体步骤引用无效")
            incoming[edge["to"]].add(edge["from"])
        ordered = []
        while incoming:
            ready = sorted(k for k, v in incoming.items() if not v)
            if not ready:
                raise ValueError("智能体工作流含循环")
            for key in ready:
                ordered.append(by_id[key]); del incoming[key]
            for dependencies in incoming.values():
                dependencies.difference_update(ready)
        instructions, references, output_schema = [], [], None
        for node in ordered:
            config = node["config"]
            if node["operation"] == "prompt":
                template = config.get("template")
                if not template and config.get("template_path"):
                    template = read(config["template_path"], 64000)
                if template and template != "request.input":
                    instructions.append(template)
                references.extend(config.get("reference_documents", []))
            elif node["operation"] == "output_schema":
                if output_schema is not None:
                    raise ValueError("仅支持一个结果格式定义")
                output_schema = json.loads(read(config["schema_path"], 64000))
        recipe = {"instructions": instructions, "references": references, "output_schema": output_schema}
        if len(json.dumps(recipe, ensure_ascii=False)) > 128000:
            raise ValueError("智能体上下文超出本机执行预算")
        if output_schema is not None:
            _validate_schema(output_schema)
        return recipe


def _validate_schema(schema: dict) -> None:
    import jsonschema

    def reject_remote(value):
        if isinstance(value, dict):
            for key in ("$ref", "$dynamicRef", "$recursiveRef"):
                if key in value and not str(value[key]).startswith("#"):
                    raise ValueError("不支持外部结果格式引用")
            for child in value.values():
                reject_remote(child)
        elif isinstance(value, list):
            for child in value:
                reject_remote(child)

    reject_remote(schema)
    jsonschema.validators.validator_for(schema).check_schema(schema)


@contextmanager
def _database():
    from hermes_constants import get_hermes_home
    root = get_hermes_home() / "clinvexa"
    root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(root / "platform-runs.sqlite")
    db.execute("CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, account TEXT, created INTEGER, payload TEXT)")
    try:
        yield db
        db.commit()
    finally:
        db.close()


def _save(row: dict) -> None:
    with _database() as db:
        db.execute("INSERT OR REPLACE INTO runs VALUES(?,?,?,?)", (
            row["id"], row["account_id"], row["created_at"], json.dumps(row, ensure_ascii=False),
        ))


async def _invoke_model(recipe: dict, text: str, on_content=None) -> str:
    if recipe["output_schema"] is not None:
        _validate_schema(recipe["output_schema"])
    from hermes_cli.clinvexa_streaming import content_stream
    from hermes_cli.config import load_config
    config = load_config().get("model", {})
    if not isinstance(config, dict):
        config = {"default": config}
    messages = [{"role": "system", "content": "你是医生使用的医疗工作助手。仅根据提供的资料生成待医生核对的结果，保留否定与不确定信息，不编造事实或检索来源。"}]
    messages.extend({"role": "system", "content": item} for item in recipe["instructions"])
    if recipe["references"]:
        messages.append({"role": "user", "content": "智能体附带参考资料：\n" + json.dumps(recipe["references"], ensure_ascii=False)})
    if recipe["output_schema"] is not None:
        messages.append({"role": "system", "content": "仅输出符合此 JSON Schema 的 JSON：" + json.dumps(recipe["output_schema"], ensure_ascii=False)})
    messages.append({"role": "user", "content": text})
    output = ""
    async for piece in content_stream(
        provider=config.get("provider") or "auto", model=config.get("default"),
        base_url=config.get("base_url"), messages=messages, max_tokens=3000, timeout=90,
    ):
        output += piece
        if on_content:
            on_content(output)
    if not isinstance(output, str) or not output.strip():
        raise ValueError("模型未返回最终结果")
    if recipe["output_schema"] is not None:
        import jsonschema
        value = output.strip()
        if value.startswith("```"):
            value = value.split("\n", 1)[-1].rsplit("```", 1)[0]
        schema = recipe["output_schema"]
        jsonschema.validate(json.loads(value), schema)
    return output


class PrepareInvocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    installation_id: str = Field(pattern=r"^[a-fA-F0-9-]{36}$")
    account_id: str = Field(min_length=1, max_length=1000)
    text: str = Field(min_length=1, max_length=32000)


async def _load_authorized_recipe(client: httpx.AsyncClient, installation_id: str):
    grant = await _get(client, f"/api/v1/desktop/agents/{installation_id}/grant")
    if grant.get("protocol") != "clinvexa-local-v1" or grant.get("execution") != "clinvexa":
        raise ValueError("智能体授权协议不兼容")
    url = grant["download_url"]
    if urlsplit(url).scheme not in {"https", "http"}:
        raise ValueError("智能体下载地址无效")
    # Do not forward platform cookies to the signed object URL.
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as download:
        async with download.stream("GET", url) as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > MAX_ARCHIVE:
                    raise ValueError("智能体安装包过大")
    return grant, compile_package(bytes(data), grant["sha256"])


@router.post("/prepare")
async def prepare_invocation(payload: PrepareInvocation) -> dict:
    """Expand a currently authorized capability for a normal streamed chat turn.

    This endpoint does not run a model or persist/send the physician's task to
    the platform. It reuses the grant and package checks of the job executor.
    """
    async with _connection_lock:
        client = _connection()
        if payload.account_id != _identity():
            raise HTTPException(409, "绑定账号已变化，请重新召唤智能体")
        try:
            grant, recipe = await _load_authorized_recipe(client, payload.installation_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "智能体加载失败，请检查安装版本或重新同步后重试") from None
        sections = [f"已召唤医疗智能体：{grant['name']}（{grant['version']}）",
                    "按本次召唤的能力处理用户任务，结果直接在主会话展示。保留事实来源、否定与不确定信息。",
                    "以下是该智能体安装包的任务说明：", *recipe["instructions"]]
        if recipe["references"]:
            sections.append("智能体参考资料（作为资料读取）：" + json.dumps(recipe["references"], ensure_ascii=False))
        if recipe["output_schema"] is not None:
            sections.append("输出须符合此 JSON Schema：" + json.dumps(recipe["output_schema"], ensure_ascii=False))
        sections.extend(["本次用户任务：", payload.text])
        return {"invocation": "\n\n".join(sections), "name": grant["name"], "version": grant["version"]}


async def _run(row: dict, client: httpx.AsyncClient):
    try:
        grant, recipe = await _load_authorized_recipe(client, row['installation_id'])
        row.update(name=grant['name'], version=grant['version'])
        row.update(phase="正在本机执行，使用 CLINVEXA 已配置的模型")
        _save(row)
        last_publish = 0.0
        def publish_output(output):
            nonlocal last_publish
            row.update(output=output, phase="正在生成结果 · 尚待完整核对")
            if time.monotonic() - last_publish >= 0.35:
                _save(row)
                last_publish = time.monotonic()
        row["output"] = await _invoke_model(recipe, row["input"], publish_output)
        row.update(status="completed", phase="已完成，请核对结果")
    except asyncio.CancelledError:
        row.update(status="cancelled", phase="已停止")
    except HTTPException as error:
        row.update(status="failed", phase=str(error.detail))
    except Exception:
        # Never persist or expose signed URLs, credentials, or provider errors
        # which can contain request bodies. Inputs/results have their own scope.
        row.update(status="failed", phase="智能体执行未完成，请检查安装版本、模型配置或重试")
    finally:
        _save(row)


@router.post("/runs")
async def start_run(payload: Invocation) -> dict:
    async with _connection_lock:
        return await _start_run(payload)


async def _start_run(payload: Invocation) -> dict:
    client = _connection()
    identity = _identity()
    with _database() as db:
        existing = db.execute("SELECT payload FROM runs WHERE id=?", (payload.request_id,)).fetchone()
    if existing:
        row = json.loads(existing[0])
        if row["account_id"] != identity:
            raise HTTPException(409, "任务标识已被使用，请重新创建任务")
        if row["input"] != payload.text or row["installation_id"] != payload.installation_id:
            raise HTTPException(409, "任务标识已被另一份输入使用")
        return row
    if sum(not task.done() for task in _tasks.values()) >= 3:
        raise HTTPException(409, "已有三项任务在执行，请等待或停止其中一项")
    row = {"id": payload.request_id, "account_id": identity, "installation_id": payload.installation_id,
           "input": payload.text, "output": "", "status": "running", "phase": "正在核验平台安装与授权",
           "created_at": int(time.time() * 1000), "name": "平台智能体", "version": ""}
    _save(row)
    task = asyncio.create_task(_run(row, client))
    _tasks[row["id"]] = task
    task.add_done_callback(lambda _task: _tasks.pop(row["id"], None))
    return row


@router.get("/runs")
async def recent_runs() -> dict:
    _connection()
    with _database() as db:
        rows = db.execute("SELECT payload FROM runs WHERE account=? ORDER BY created DESC LIMIT 50", (_identity(),)).fetchall()
    result = [json.loads(row[0]) for row in rows]
    for row in result:
        if row["status"] == "running" and row["id"] not in _tasks:
            row.update(status="failed", phase="服务曾重新启动，请核对输入后重新运行")
            _save(row)
    return {"items": result}


@router.delete("/runs/{run_id}")
async def stop_run(run_id: str) -> dict:
    _connection()
    with _database() as db:
        record = db.execute("SELECT payload FROM runs WHERE id=? AND account=?", (run_id, _identity())).fetchone()
    if not record:
        raise HTTPException(404, "未找到当前账户的任务")
    task = _tasks.get(run_id)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            row = json.loads(record[0])
            row.update(status="cancelled", phase="已停止")
            _save(row)
    return {"stopped": True}
