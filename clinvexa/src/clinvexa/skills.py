"""Minimal local Skill plaza synchronized with Hermes Skills directories."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

import yaml

SkillScope = Literal["department", "personal", "platform"]
_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_MANIFEST_NAME = ".clinvexa.json"
logger = logging.getLogger(__name__)


class CatalogError(ValueError):
    """Report an invalid CLINVEXA catalog or Skill package."""


class SkillOperationError(RuntimeError):
    """Report a failed local Skill lifecycle operation."""


@dataclass(frozen=True, slots=True)
class CatalogSkill:
    """Describe one browsable CLINVEXA Skill."""

    default_version: str
    dependencies: tuple[str, ...]
    description: str
    name: str
    scope: SkillScope
    source_path: Path
    title: str
    versions: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InstalledSkill:
    """Describe one Skill synchronized into Hermes."""

    enabled: bool
    name: str
    path: Path
    version: str

    @property
    def added_at(self) -> float:
        """Stable installation time; migrate older installs from directory creation time."""
        manifest = self.path / _MANIFEST_NAME
        if manifest.is_file():
            try:
                payload = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                payload = {}
            value = payload.get("added_at") if isinstance(payload, dict) else None
            if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
                return float(value)
        stat = self.path.stat()
        return float(getattr(stat, "st_birthtime", stat.st_ctime))


class CLINVEXASkillPlaza:
    """Manage a trusted local catalog inside one Hermes profile's Skills tree."""

    def __init__(
        self,
        catalog: tuple[CatalogSkill, ...],
        skills_root: Path,
        available_dependencies: set[str] | None = None,
    ) -> None:
        """Initialize a validated catalog and exact Hermes Skills destination.

        Args:
            catalog: Validated catalog entries.
            skills_root: Active Hermes profile's ``skills`` directory.
            available_dependencies: Runtime dependency identifiers available to Skills.
        """
        self._catalog = catalog
        self._by_name = {skill.name: skill for skill in catalog}
        self._skills_root = skills_root.resolve()
        self._active_root = self._skills_root / "clinvexa"
        self._disabled_root = self._skills_root.parent / ".clinvexa-disabled-skills"
        self._available_dependencies = available_dependencies or set()

    @classmethod
    def from_catalog(
        cls,
        catalog_path: Path,
        skills_root: Path,
        available_dependencies: set[str] | None = None,
    ) -> CLINVEXASkillPlaza:
        """Load and validate one local CLINVEXA catalog.

        Args:
            catalog_path: Path to ``catalog.json``.
            skills_root: Active Hermes profile's ``skills`` directory.
            available_dependencies: Runtime dependency identifiers available to Skills.

        Returns:
            Ready local Skill plaza.

        Raises:
            CatalogError: If catalog metadata or a Skill package is invalid.
        """
        try:
            payload = json.loads(catalog_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise CatalogError(f"catalog cannot be read: {exc}") from exc
        rows = payload.get("skills")
        if not isinstance(rows, list):
            raise CatalogError("catalog skills must be a list")

        catalog_root = catalog_path.parent.resolve()
        seen: set[str] = set()
        entries: list[CatalogSkill] = []
        for row in rows:
            if not isinstance(row, dict):
                raise CatalogError("catalog skill must be an object")
            name = str(row.get("name", ""))
            if not _NAME_PATTERN.fullmatch(name):
                raise CatalogError(f"invalid skill name: {name}")
            if name in seen:
                raise CatalogError(f"duplicate skill: {name}")
            seen.add(name)
            source_path = (catalog_root / str(row.get("source", ""))).resolve()
            try:
                source_path.relative_to(catalog_root)
            except ValueError as exc:
                raise CatalogError(f"skill source escapes catalog: {name}") from exc
            skill_md = source_path / "SKILL.md"
            if not skill_md.is_file():
                raise CatalogError(f"missing SKILL.md: {name}")
            if source_path.is_symlink():
                raise CatalogError(f"skill source cannot be a symlink: {name}")
            declared_name = _frontmatter_name(skill_md)
            if declared_name != name:
                raise CatalogError(f"SKILL.md name mismatch: {name}")

            versions = tuple(str(version) for version in row.get("versions", []))
            default_version = str(row.get("default_version", ""))
            if not versions or default_version not in versions:
                raise CatalogError(f"invalid versions: {name}")
            scope = str(row.get("scope", ""))
            if scope not in {"department", "personal", "platform"}:
                raise CatalogError(f"invalid scope: {name}")
            entries.append(
                CatalogSkill(
                    default_version=default_version,
                    dependencies=tuple(str(item) for item in row.get("dependencies", [])),
                    description=str(row.get("description", "")),
                    name=name,
                    scope=cast(SkillScope, scope),
                    source_path=source_path,
                    title=str(row.get("title", name)),
                    versions=versions,
                )
            )
        return cls(tuple(entries), skills_root, available_dependencies)

    def browse(self) -> tuple[CatalogSkill, ...]:
        """Return source catalog entries followed by valid agent-created Skills."""
        entries = list(self._catalog)
        known = set(self._by_name)
        for skill in self._dynamic_skills():
            if skill.name not in known:
                entries.append(skill)
                known.add(skill.name)
        return tuple(entries)

    def search(self, query: str) -> tuple[CatalogSkill, ...]:
        """Search catalog names, titles, descriptions, and scope labels.

        Args:
            query: Case-insensitive search text.

        Returns:
            Matching catalog entries in stable order.
        """
        normalized = query.strip().casefold()
        if not normalized:
            return self.browse()
        return tuple(
            skill
            for skill in self.browse()
            if normalized
            in " ".join((skill.name, skill.title, skill.description, skill.scope)).casefold()
        )

    def install(self, name: str, version: str | None = None) -> InstalledSkill:
        """Install one catalog Skill into the active Hermes profile.

        Args:
            name: Catalog Skill name.
            version: Catalog version, or the default when omitted.

        Returns:
            Installed enabled Skill.

        Raises:
            SkillOperationError: If dependencies, version, or lifecycle state are invalid.
        """
        skill = self._catalog_skill(name)
        selected_version = version or skill.default_version
        self._validate_version(skill, selected_version)
        missing = [item for item in skill.dependencies if item not in self._available_dependencies]
        if missing:
            raise SkillOperationError(f"missing dependency: {', '.join(missing)}")
        if self._active_path(name).exists() or self._disabled_path(name).exists():
            raise SkillOperationError(f"skill is already installed: {name}")
        self._active_root.mkdir(parents=True, exist_ok=True)
        target = self._active_path(name)
        staged = self._stage(skill, selected_version, self._active_root)
        os.replace(staged, target)
        _invalidate_hermes_skill_cache()
        return InstalledSkill(enabled=True, name=name, path=target, version=selected_version)

    def disable(self, name: str) -> InstalledSkill:
        """Disable an installed Skill for subsequent Hermes sessions."""
        source = self._active_path(name)
        if not source.is_dir():
            if self._disabled_path(name).is_dir():
                raise SkillOperationError(f"skill is disabled: {name}")
            raise SkillOperationError(f"skill is not installed: {name}")
        self._disabled_root.mkdir(parents=True, exist_ok=True)
        target = self._disabled_path(name)
        os.replace(source, target)
        _invalidate_hermes_skill_cache()
        return self._read_installed(target, enabled=False)

    def enable(self, name: str) -> InstalledSkill:
        """Enable a disabled Skill for subsequent Hermes sessions."""
        source = self._disabled_path(name)
        if not source.is_dir():
            if self._active_path(name).is_dir():
                return self._read_installed(self._active_path(name), enabled=True)
            raise SkillOperationError(f"skill is not installed: {name}")
        self._active_root.mkdir(parents=True, exist_ok=True)
        target = self._active_path(name)
        os.replace(source, target)
        _invalidate_hermes_skill_cache()
        return self._read_installed(target, enabled=True)

    def switch_version(self, name: str, version: str) -> InstalledSkill:
        """Atomically replace an installed Skill with another catalog version."""
        skill = self._catalog_skill(name)
        self._validate_version(skill, version)
        active = self._active_path(name)
        disabled = self._disabled_path(name)
        current = active if active.is_dir() else disabled if disabled.is_dir() else None
        if current is None:
            raise SkillOperationError(f"skill is not installed: {name}")
        enabled = current == active
        staged = self._stage(skill, version, current.parent)
        backup = current.with_name(f".{name}-backup-{uuid.uuid4().hex}")
        os.replace(current, backup)
        try:
            os.replace(staged, current)
        except OSError:
            os.replace(backup, current)
            if staged.exists():
                shutil.rmtree(staged)
            raise
        shutil.rmtree(backup)
        _invalidate_hermes_skill_cache()
        return InstalledSkill(enabled=enabled, name=name, path=current, version=version)

    def uninstall(self, name: str) -> None:
        """Remove one exact CLINVEXA Skill directory from the Hermes profile."""
        active = self._active_path(name)
        disabled = self._disabled_path(name)
        target = active if active.is_dir() else disabled if disabled.is_dir() else None
        if target is None:
            raise SkillOperationError(f"skill is not installed: {name}")
        expected_parent = self._active_root if target == active else self._disabled_root
        _assert_direct_child(target, expected_parent)
        shutil.rmtree(target)
        _invalidate_hermes_skill_cache()

    def list_installed(self) -> tuple[InstalledSkill, ...]:
        """List enabled and disabled CLINVEXA Skills without duplicates."""
        installed: dict[str, InstalledSkill] = {}
        for root, enabled in ((self._active_root, True), (self._disabled_root, False)):
            if not root.is_dir():
                continue
            for path in sorted(item for item in root.iterdir() if item.is_dir() and not item.name.startswith(".")):
                try:
                    current = self._read_installed(path, enabled)
                except (CatalogError, SkillOperationError):
                    logger.warning("ignoring invalid CLINVEXA Skill directory: %s", path, exc_info=True)
                    continue
                if current.name in installed:
                    raise SkillOperationError(f"duplicate installed skill: {current.name}")
                installed[current.name] = current
        return tuple(installed[name] for name in sorted(installed))

    def synchronize_installed_catalog(self) -> tuple[InstalledSkill, ...]:
        """Refresh installed built-in Skills from the packaged catalog.

        Only catalog-owned Skills are replaced. Agent-created Skills are left
        untouched, and the enabled/disabled state of every built-in is kept.
        """
        refreshed: list[InstalledSkill] = []
        for skill in self._catalog:
            active = self._active_path(skill.name)
            disabled = self._disabled_path(skill.name)
            current = active if active.is_dir() else disabled if disabled.is_dir() else None
            if current is None:
                continue

            expected_digest = _directory_digest(skill.source_path)
            current_digest = _directory_digest(current)
            try:
                installed_version = self._read_installed(current, enabled=current == active).version
            except (CatalogError, SkillOperationError):
                installed_version = ""
            if installed_version == skill.default_version and current_digest == expected_digest:
                continue

            staged = self._stage(skill, skill.default_version, current.parent)
            backup = current.with_name(f".{skill.name}-backup-{uuid.uuid4().hex}")
            os.replace(current, backup)
            try:
                os.replace(staged, current)
            except OSError:
                os.replace(backup, current)
                if staged.exists():
                    shutil.rmtree(staged)
                raise
            shutil.rmtree(backup)
            refreshed.append(
                InstalledSkill(
                    enabled=current == active,
                    name=skill.name,
                    path=current,
                    version=skill.default_version,
                )
            )

        if refreshed:
            _invalidate_hermes_skill_cache()
        return tuple(refreshed)

    def build_invocation(self, name: str, task: str) -> str:
        """Build an explicit Hermes Skill invocation for a doctor's task."""
        if self._disabled_path(name).is_dir():
            raise SkillOperationError(f"skill is disabled: {name}")
        if not self._active_path(name).is_dir():
            raise SkillOperationError(f"skill is not installed: {name}")
        normalized_task = task.strip()
        if not normalized_task:
            raise SkillOperationError("skill task cannot be empty")
        skill = next((item for item in self.browse() if item.name == name), None)
        if skill is None:
            raise SkillOperationError(f"skill is not in catalog: {name}")
        deterministic_protocol = ""
        if name in {"record-structuring", "outpatient-note-draft", "followup-plan"}:
            deterministic_protocol = (
                "\n固定执行协议：只允许调用 CLINVEXA 内置确定性入口 "
                f"`python -m clinvexa.deterministic_skills {name} --source <当前附件绝对路径>`。"
                "不得自行分析医疗内容，不得临时编写 PowerShell/Python，不得改变输出格式，"
                "不得把缺失事实补写为诊断、医嘱或随访事项。脚本失败时原样返回错误。"
            )
        return (
            f"${name}\n"
            f"CLINVEXA Skill：{skill.title}\n"
            f"使用场景与功能：{skill.description}\n"
            f"任务：{normalized_task}"
            f"{deterministic_protocol}"
        )

    def _catalog_skill(self, name: str) -> CatalogSkill:
        try:
            return self._by_name[name]
        except KeyError as exc:
            raise SkillOperationError(f"skill is not in catalog: {name}") from exc

    def _validate_version(self, skill: CatalogSkill, version: str) -> None:
        if version not in skill.versions:
            raise SkillOperationError(f"skill version is unavailable: {skill.name}@{version}")

    def _active_path(self, name: str) -> Path:
        return self._active_root / name

    def _disabled_path(self, name: str) -> Path:
        return self._disabled_root / name

    def _stage(self, skill: CatalogSkill, version: str, parent: Path) -> Path:
        added_at = time.time()
        for current in (self._active_path(skill.name), self._disabled_path(skill.name)):
            if current.is_dir():
                added_at = InstalledSkill(True, skill.name, current, version).added_at
                break
        staged = parent / f".{skill.name}-stage-{uuid.uuid4().hex}"
        shutil.copytree(skill.source_path, staged)
        staged.joinpath(_MANIFEST_NAME).write_text(
            json.dumps(
                {
                    "name": skill.name,
                    "added_at": added_at,
                    "source_digest": _directory_digest(skill.source_path),
                    "version": version,
                },
                ensure_ascii=False,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        return staged

    def _dynamic_skills(self) -> tuple[CatalogSkill, ...]:
        entries: dict[str, CatalogSkill] = {}
        for root in (self._active_root, self._disabled_root):
            if not root.is_dir():
                continue
            for path in sorted(item for item in root.iterdir() if item.is_dir() and not item.name.startswith(".")):
                if path.name in self._by_name or path.name in entries:
                    continue
                try:
                    name, description, title = _skill_metadata(path / "SKILL.md")
                except CatalogError:
                    logger.warning("ignoring invalid CLINVEXA Skill metadata: %s", path, exc_info=True)
                    continue
                if name != path.name or not _NAME_PATTERN.fullmatch(name):
                    logger.warning("ignoring mismatched CLINVEXA Skill directory: %s", path)
                    continue
                entries[name] = CatalogSkill(
                    default_version="1.0.0",
                    dependencies=(),
                    description=description,
                    name=name,
                    scope="personal",
                    source_path=path,
                    title=title,
                    versions=("1.0.0",),
                )
        return tuple(entries[name] for name in sorted(entries))

    def _read_installed(self, path: Path, enabled: bool) -> InstalledSkill:
        manifest_path = path / _MANIFEST_NAME
        if not manifest_path.is_file():
            catalog_skill = self._by_name.get(path.name)
            skill_md = path / "SKILL.md"
            declared_name = _frontmatter_name(skill_md)
            if declared_name != path.name:
                raise SkillOperationError(f"installed skill name mismatch: {path.name}")
            if catalog_skill is not None:
                return InstalledSkill(
                    enabled=enabled,
                    name=catalog_skill.name,
                    path=path,
                    version=catalog_skill.default_version,
                )
            return InstalledSkill(enabled=enabled, name=declared_name, path=path, version="1.0.0")
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SkillOperationError(f"installed skill manifest is invalid: {path.name}") from exc
        try:
            name = str(payload["name"])
            version = str(payload["version"])
        except (KeyError, TypeError) as exc:
            raise SkillOperationError(f"installed skill manifest is invalid: {path.name}") from exc
        if name != path.name or not (path / "SKILL.md").is_file() or _frontmatter_name(path / "SKILL.md") != name:
            raise SkillOperationError(f"installed skill manifest is invalid: {path.name}")
        return InstalledSkill(enabled=enabled, name=name, path=path, version=version)


def _frontmatter_name(skill_md: Path) -> str:
    name, _, _ = _skill_metadata(skill_md)
    return name


def _skill_metadata(skill_md: Path) -> tuple[str, str, str]:
    try:
        text = skill_md.read_text(encoding="utf-8")
    except OSError as exc:
        raise CatalogError(f"missing SKILL.md: {skill_md.parent.name}") from exc
    match = re.match(r"^---\s*\n(?P<header>.*?)\n---", text, re.DOTALL)
    if not match:
        raise CatalogError(f"invalid SKILL.md frontmatter: {skill_md.parent.name}")
    try:
        payload = yaml.safe_load(match.group("header"))
    except yaml.YAMLError as exc:
        raise CatalogError(f"invalid SKILL.md frontmatter: {skill_md.parent.name}") from exc
    if not isinstance(payload, dict) or not str(payload.get("name", "")).strip():
        raise CatalogError(f"missing SKILL.md name: {skill_md.parent.name}")
    description = str(payload.get("description", "")).strip()
    if not description:
        raise CatalogError(f"missing SKILL.md description: {skill_md.parent.name}")
    name = str(payload["name"]).strip()
    body = text[match.end() :]
    title_match = re.search(r"^#\s+(.+?)\s*$", body, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else name
    return name, description, title


def _assert_direct_child(path: Path, expected_parent: Path) -> None:
    resolved_path = path.resolve()
    resolved_parent = expected_parent.resolve()
    if resolved_path.parent != resolved_parent or resolved_path == resolved_parent:
        raise SkillOperationError(f"refusing unmanaged skill path: {path}")


def _directory_digest(root: Path) -> str:
    """Hash one Skill package deterministically, excluding install metadata."""
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix()
        if relative == _MANIFEST_NAME or "__pycache__" in path.parts:
            continue
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()




def _invalidate_hermes_skill_cache() -> None:
    try:
        from tools import skills_tool
    except ImportError:
        return
    skills_tool._SKILLS_CACHE.clear()
