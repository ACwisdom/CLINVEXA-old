"""Exercise packaged Skill registration through a real isolated interpreter."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig

import pytest

from scripts.clinvexa_live_voice_bundle import provision_skill_runtime


def test_missing_skill_payload_is_not_reported_ready(tmp_path):
    with pytest.raises(RuntimeError, match='incomplete'):
        provision_skill_runtime(tmp_path / 'uv', tmp_path)


def test_clean_terminal_can_run_all_fixed_skills_after_offline_registration(tmp_path):
    uv = shutil.which('uv')
    if not uv:
        pytest.skip('uv is required for the offline provisioning integration test')
    root = Path(__file__).resolve().parents[2]
    source = tmp_path / 'installed runtime' / 'hermes-agent'
    package = source / 'clinvexa'
    shutil.copytree(root / 'clinvexa' / 'src', package / 'src',
                    ignore=shutil.ignore_patterns('__pycache__', '*.egg-info'))
    shutil.copyfile(root / 'clinvexa' / 'pyproject.toml', package / 'pyproject.toml')
    env_dir = tmp_path / 'venv'
    subprocess.run([sys.executable, '-m', 'venv', '--without-pip', '--system-site-packages', str(env_dir)], check=True)
    python = env_dir / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    # venv inherits base Python's site-packages, not the parent test venv.
    # Reuse its installed build tools without fetching anything from a network.
    purelib = subprocess.check_output([str(python), '-I', '-c',
                                      'import sysconfig;print(sysconfig.get_path("purelib"))'], text=True).strip()
    Path(purelib, 'test-build-tools.pth').write_text(sysconfig.get_path('purelib') + '\n', encoding='utf-8')
    unrelated = tmp_path / 'work files'
    unrelated.mkdir()
    env = dict(os.environ)
    env.pop('PYTHONPATH', None)
    code = (
        'import runpy,sys; from pathlib import Path; '
        'f=runpy.run_path(sys.argv[1])["provision_skill_runtime"]; '
        'print(f(Path(sys.argv[2]),Path(sys.argv[3])))'
    )
    command = [str(python), '-I', '-c', code,
               str(root / 'scripts/clinvexa_live_voice_bundle.py'), uv, str(source)]
    first = subprocess.run(command, cwd=unrelated, env=env, capture_output=True, text=True, timeout=120)
    assert first.returncode == 0, first.stderr
    assert first.stdout.strip() == 'True'
    second = subprocess.run(command, cwd=unrelated, env=env, capture_output=True, text=True, timeout=60)
    assert second.returncode == 0, second.stderr
    assert second.stdout.strip() == 'False'
    record = unrelated / '病例 中文 空格.txt'
    record.write_text('患者姓名：合成测试\n主诉：咳嗽3天\n随访时间：一周后\n随访方式：门诊复诊', encoding='utf-8')
    for name, extension in [('record-structuring', '.xlsx'), ('outpatient-note-draft', '.txt'), ('followup-plan', '.txt')]:
        output = unrelated / (name + extension)
        result = subprocess.run([str(python), '-I', '-m', 'clinvexa.deterministic_skills',
                                 name, '--source', str(record), '--output', str(output)],
                                cwd=unrelated, env=env, capture_output=True, encoding='utf-8', timeout=30)
        assert result.returncode == 0, result.stderr
        assert Path(result.stdout.strip()) == output
        assert output.stat().st_size > 0
        if extension == '.xlsx':
            from zipfile import ZipFile
            with ZipFile(output) as book:
                assert len([p for p in book.namelist() if p.startswith('xl/worksheets/sheet')]) == 1
        else:
            text = output.read_text(encoding='utf-8-sig')
            assert ('咳嗽3天' if name == 'outpatient-note-draft' else '一周后') in text
            assert 'requires_human_review: true' in text
