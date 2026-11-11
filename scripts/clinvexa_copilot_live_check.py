"""Measure the real copilot with an explicitly supplied synthetic screenshot.

Uses the installed model configuration in an isolated result directory; never
captures the live desktop or writes credentials to the evidence report.
"""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-home", type=Path, required=True)
    parser.add_argument("--synthetic-image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--vision-model", default="")
    parser.add_argument("--independent", action="store_true", help="No earlier synthetic results reused between runs")
    args = parser.parse_args()
    import yaml
    from dotenv import dotenv_values
    config = yaml.safe_load((args.runtime_home / "config.yaml").read_text(encoding="utf-8"))
    run_home = Path(tempfile.mkdtemp(prefix="clinvexa-live-synthetic-"))
    model = config.get("model", {})
    vision = config.get("auxiliary", {}).get("vision", {})
    if args.vision_model:
        vision = {**vision, "model": args.vision_model}
    settings = {"model": model, "providers": config.get("providers", {}), "auxiliary": {"vision": vision}, "stt": {"enabled": False}}
    (run_home / "config.yaml").write_text(yaml.safe_dump(settings, allow_unicode=True), encoding="utf-8")
    key_names = {model.get("key_env"), vision.get("key_env")}
    key_names.update(provider.get("key_env") for provider in config.get("providers", {}).values() if isinstance(provider, dict))
    for key, value in dotenv_values(args.runtime_home / ".env").items():
        if value and (key in key_names or key.startswith(("DASHSCOPE_", "ALIYUN_", "QWEN_")) or key in {"OPENAI_API_KEY", "CUSTOM_API_KEY"}):
            os.environ[key] = value
    os.environ["HERMES_HOME"] = str(run_home)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from hermes_cli.clinvexa_copilot import analyze_screen, ScreenRequest
    image = "data:image/png;base64," + base64.b64encode(args.synthetic_image.read_bytes()).decode()
    report = {"synthetic": True, "model": {key: model.get(key) for key in ("provider", "default")}, "visionModel": args.vision_model or vision.get("model") or model.get("default"), "runs": []}
    async def run():
        for index in range(args.runs):
            if args.independent:
                from hermes_cli.clinvexa_copilot import _database
                with _database() as db:
                    db.execute("DELETE FROM copilot_results")
            started = time.monotonic()
            entry = {"run": index + 1}
            try:
                result = await analyze_screen(ScreenRequest(frameId=f"live-{index}", windowId="synthetic",
                    title="CLINVEXA 合成验收 HIS", processName="synthetic-test", capturedAt=int(time.time()*1000), imageDataUrl=image))
                entry.update(success=True, result=result)
            except Exception as error:
                entry.update(success=False, error=getattr(error, "detail", type(error).__name__),
                             cause=type(error.__cause__).__name__ if error.__cause__ else None)
                if hasattr(error.__cause__, "errors"):
                    entry["validation"] = error.__cause__.errors(include_input=False, include_context=False, include_url=False)
            entry["elapsedMs"] = round((time.monotonic()-started)*1000)
            report["runs"].append(entry)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({key:value for key,value in entry.items() if key != "result"},ensure_ascii=False), flush=True)
    asyncio.run(run())
    return 0 if all(item["success"] for item in report["runs"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
