"""Provision and verify consultation ASR exclusively from the installed payload.

Runs with the product's Python. No pip/network/system Python fallback is allowed.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid


def sha(path: Path) -> str:
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def model_target(home: Path, relative: Path) -> Path:
    """Keep writes inside runtime, including when an existing file is hard-linked.

    On Windows ``Path.resolve()`` can return another name for a hard-linked
    *file*. Resolve the parent to reject junction escapes, then preserve the
    final filename so a valid hard link does not look like an escape.
    """
    root = home.resolve()
    parent = (home / relative.parent).resolve()
    if not parent.is_relative_to(root):
        raise RuntimeError('Voice destination outside runtime')
    target = parent / relative.name
    if target.is_symlink():
        raise RuntimeError('Voice destination is a symbolic link')
    return target


def quarantine_duplicate_metadata(site: Path, backup: Path, versions: dict[str, str]) -> list[str]:
    """Preserve stale metadata from earlier in-place runtime upgrades.

    A package's code may be healthy while two ``.dist-info`` versions make
    ``uv pip check`` reject the entire offline runtime. Keep the metadata that
    matches the imported code and move the other version into a reversible
    runtime backup outside ``site-packages``.
    """
    moved = []
    for package, active_version in versions.items():
        candidates = list(site.glob(f'{package}-*.dist-info'))
        if len(candidates) < 2:
            continue
        active = f'{package}-{active_version}.dist-info'.casefold()
        if not any(path.name.casefold() == active for path in candidates):
            raise RuntimeError(f'Cannot identify active {package} distribution metadata')
        for path in candidates:
            if path.name.casefold() == active:
                continue
            backup.mkdir(parents=True, exist_ok=True)
            path.rename(backup / f'{path.name}.{uuid.uuid4().hex[:8]}')
            moved.append(path.name)
    return moved


def repair_runtime_metadata(home: Path) -> list[str]:
    site = Path(sys.prefix) / 'Lib' / 'site-packages'
    if not site.resolve().is_relative_to(home.resolve()):
        raise RuntimeError('Python runtime outside CLINVEXA home')
    versions = {
        name: str(importlib.import_module(name).__version__)
        for name in ('filelock', 'httpx2', 'httpcore2')
    }
    return quarantine_duplicate_metadata(site, home / 'cache' / 'stale-python-metadata', versions)


def provision_skill_runtime(uv: Path, source_root: Path) -> bool:
    """Expose the bundled Skills to terminal children, not only the HTTP worker.

    The medical worker's PYTHONPATH masks a missing package installation. Probe
    with isolated Python so this check cannot pass solely because the caller
    injected that path or happens to be in the source checkout.
    """
    package = source_root / 'clinvexa'
    expected = (package / 'src' / 'clinvexa' / 'deterministic_skills.py').resolve()
    if not expected.is_file() or not (package / 'pyproject.toml').is_file():
        raise RuntimeError('Bundled CLINVEXA Skill runtime is incomplete')

    def available() -> bool:
        probe = subprocess.run(
            [sys.executable, '-I', '-c',
             'import pathlib,sys; import clinvexa.deterministic_skills as m; '
             'sys.exit(pathlib.Path(m.__file__).resolve() != pathlib.Path(sys.argv[1]).resolve())',
             str(expected)], cwd=source_root.parent, capture_output=True, timeout=30)
        return probe.returncode == 0

    if available():
        return False
    # Editable src-layout registration follows the managed payload across
    # upgrades. Build tools are already bundled; never reach PyPI or use a
    # system interpreter to repair the product runtime.
    installed = subprocess.run(
        [str(uv), 'pip', 'install', '--python', sys.executable, '--offline',
         '--no-deps', '--no-build-isolation', '--editable', str(package)],
        capture_output=True, encoding='utf-8', errors='replace', timeout=120)
    if installed.returncode:
        raise RuntimeError('Offline CLINVEXA Skill registration failed: ' + installed.stderr[-1500:])
    if not available():
        raise RuntimeError('CLINVEXA Skill runtime is not importable by terminal Python')
    return True


def provision(bundle: Path, home: Path, verify: bool = False) -> dict:
    manifest_path = bundle / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    marker = home / '.clinvexa-live-voice.json'
    identity = sha(manifest_path)
    try:
        previous = json.loads(marker.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        previous = {}
    changed = previous.get('manifest') != identity
    for entry in manifest['files']:
        relative = Path(entry['path'])
        source = (bundle / relative).resolve()
        if not source.is_relative_to(bundle.resolve()) or not source.is_file():
            raise RuntimeError(f'Incomplete voice bundle: {relative}')
        if relative.parts[0] != 'models':
            if (changed or verify) and sha(source) != entry['sha256']:
                raise RuntimeError(f'Voice payload checksum mismatch: {relative}')
            continue
        target = model_target(home, relative)
        healthy = target.is_file() and target.stat().st_size == entry['bytes']
        if healthy and (changed or verify):
            healthy = sha(target) == entry['sha256']
        if not healthy:
            if sha(source) != entry['sha256']:
                raise RuntimeError(f'Voice model checksum mismatch: {relative}')
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(target.name + '.installing')
            shutil.copyfile(source, partial)
            partial.replace(target)
            changed = True
    # Import in a child so a newly installed DLL can be loaded by this process.
    probe = subprocess.run([sys.executable, '-c', 'import sherpa_onnx,numpy,pypdf,docx,openpyxl,pptx,pandas,reportlab,pdfplumber,setuptools; assert sherpa_onnx.__version__ == "1.13.4"'], capture_output=True)
    if probe.returncode:
        uv = home / 'bin' / 'uv.exe'
        if not uv.is_file():
            raise RuntimeError('Bundled dependency installer is missing')
        subprocess.run([str(uv), 'pip', 'install', '--python', sys.executable, '--no-index',
                        '--find-links', str(bundle / 'wheelhouse'), *manifest['requirements']], check=True)
        changed = True
    # Importing a module does not prove that all of its declared runtime
    # dependencies were shipped (CTranslate2 can import without setuptools).
    uv = home / 'bin' / 'uv.exe'
    if not uv.is_file():
        raise RuntimeError('Bundled dependency verifier is missing')
    skill_runtime_repaired = provision_skill_runtime(uv, Path(__file__).resolve().parents[1])
    repair_runtime_metadata(home)
    compatibility = subprocess.run([str(uv), 'pip', 'check', '--python', sys.executable],
                                   capture_output=True, text=True, timeout=60)
    if compatibility.returncode:
        raise RuntimeError('Installed dependency compatibility check failed: ' + compatibility.stderr[-1500:])
    if changed or verify:
        os.environ['HERMES_HOME'] = str(home)
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'clinvexa' / 'src'))
        from clinvexa.live_asr import transcribe
        results = []
        for dialect in ('auto', 'yue', 'shanghai', 'beijing'):
            result = transcribe(str(bundle / 'smoke.wav'), dialect)
            if not result.get('success') or '头痛' not in result.get('transcript', ''):
                raise RuntimeError(f'Local ASR decode check failed ({dialect}): {result.get("error", "speech not recognized")}')
            results.append({'dialect': dialect, 'latencyMs': result.get('latency_ms'), 'decoded': True})
        marker.parent.mkdir(parents=True, exist_ok=True)
        from clinvexa_document_checks import verify_documents
        document_checks = verify_documents()
        marker.write_text(json.dumps({'manifest': identity, 'decodeChecks': results, 'documentChecks': document_checks}, indent=2), encoding='utf-8')
    return {'ready': True, 'offline': True, 'manifest': identity, 'repaired': changed,
            'skill_runtime_ready': True, 'skill_runtime_repaired': skill_runtime_repaired}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    print(json.dumps(provision(args.bundle, args.home, args.verify)))
