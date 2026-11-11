"""Release acceptance, executed with a clean installed runtime's own Python.

No developer interpreter, external executable lookup, or import-only success
for the speech/document/browser engines. Synthetic data only.
"""
import argparse
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--home', type=Path, required=True)
parser.add_argument('--bundle', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
home = args.home.resolve()
source = home / 'hermes-agent'
def runtime_path(path):
    """Check the containing directory without resolving Windows hardlink aliases."""
    value = Path(path)
    if value.is_symlink():
        raise RuntimeError(f'Symlinked runtime executable is not allowed: {value}')
    return value.parent.resolve() / value.name


assert runtime_path(sys.executable).is_relative_to(source), 'Developer Python is not allowed'
os.environ['HERMES_HOME'] = str(home)
sys.path[:0] = [str(source / 'scripts'), str(source / 'clinvexa/src'), str(source)]
os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(home / 'ms-playwright')
os.environ['PATH'] = os.pathsep.join([str(home / 'node'), str(home / 'bin'),
    str(Path(os.environ['SystemRoot']) / 'System32'), str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0')])
checks = []


def check(name, function):
    started = time.monotonic()
    try:
        detail = function()
        checks.append({'name': name, 'passed': True, 'detail': detail, 'milliseconds': round((time.monotonic()-started)*1000)})
    except Exception as error:
        checks.append({'name': name, 'passed': False, 'error': str(error)})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'passed': all(row['passed'] for row in checks), 'python': sys.executable,
        'home': str(home), 'checks': checks}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(name, 'PASS' if checks[-1]['passed'] else 'FAIL', flush=True)


def command(argv, timeout=90):
    result = subprocess.run([str(value) for value in argv], cwd=source, capture_output=True,
                            encoding='utf-8', errors='replace', timeout=timeout,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError(f'{Path(argv[0]).name} exited {result.returncode}: {result.stderr[-800:]}')
    return result.stdout.strip()


def check_imports():
    names = ['fastapi', 'uvicorn', 'openai', 'httpx', 'websockets', 'yaml', 'mcp', 'PIL',
             'sounddevice', 'av', 'ctranslate2', 'croniter', 'psutil',
             'clinvexa.main', 'clinvexa.rpa', 'clinvexa.memory', 'clinvexa.records',
             'tools.browser_tool', 'tools.computer_use.tool', 'hermes_cli.clinvexa_platform']
    for name in names:
        module = importlib.import_module(name)
        location = getattr(module, '__file__', None)
        if location and not runtime_path(location).is_relative_to(home):
            raise RuntimeError(f'Non-bundled import: {name}: {location}')
    return names


check('product-imports-from-installed-home', check_imports)
check('installed-dependency-compatibility', lambda: command([home / 'bin/uv.exe', 'pip', 'check', '--python', sys.executable]))
check('document-read-write-engines', lambda: __import__('clinvexa_document_checks').verify_documents())
check('realtime-asr-offline-decode', lambda: command([sys.executable, source / 'scripts/clinvexa_live_voice_bundle.py',
    '--bundle', args.bundle, '--home', home, '--verify'], timeout=360))


def whisper():
    from faster_whisper import WhisperModel
    model = WhisperModel('medium', device='cpu', compute_type='int8', cpu_threads=2,
                         download_root=str(home / 'models/faster-whisper'), local_files_only=True)
    segments, _ = model.transcribe(str(args.bundle / 'smoke.wav'), language='zh', beam_size=1)
    text = ''.join(segment.text for segment in segments)
    assert '头痛' in text or '頭痛' in text, 'Bundled dictation decoder did not recover spoken symptom'
    return {'decoded': True, 'engine': 'faster-whisper'}


check('general-dictation-offline-decode', whisper)
check('bundled-node-execution', lambda: command([home / 'node/node.exe', '-e', 'process.stdout.write("NODE_OK")']))
check('bundled-ripgrep-execution', lambda: command([home / 'bin/rg.exe', '--version']).splitlines()[0])
check('bundled-computer-use-driver', lambda: command([home / 'cua-driver/bin/cua-driver.exe', '--version']))


def git_bash():
    candidates = [home / 'portable-git/bin/bash.exe', home / 'git/bin/bash.exe']
    executable = next((item for item in candidates if item.is_file()), None)
    assert executable, 'Bundled Git Bash is missing'
    return command([executable, '-c', 'printf BASH_OK; git --version'])


check('bundled-git-bash-execution', git_bash)


def media():
    with tempfile.TemporaryDirectory() as temporary:
        target = Path(temporary) / 'audio.wav'
        command([home / 'bin/ffmpeg.exe', '-v', 'error', '-i', args.bundle / 'smoke.wav', '-ar', '16000', '-ac', '1', target])
        data = json.loads(command([home / 'bin/ffprobe.exe', '-v', 'error', '-show_streams', '-of', 'json', target]))
        assert data['streams'][0]['sample_rate'] == '16000'
    return {'wavDecodeEncode': True}


check('bundled-audio-codec-conversion', media)


def browser():
    from tools import browser_tool
    chrome = next((home / 'ms-playwright').glob('chromium-*/chrome-win64/chrome.exe'))
    os.environ['AGENT_BROWSER_EXECUTABLE_PATH'] = str(chrome)
    os.environ['PATH'] = str(source / 'node_modules/.bin') + os.pathsep + os.environ['PATH']
    os.environ.pop('BROWSER_CDP_URL', None)
    cli = runtime_path(browser_tool._find_agent_browser())
    assert cli.is_relative_to(home), f'Non-bundled browser driver: {cli}'
    session = 'dc-release-audit-' + str(os.getpid())
    def run(action, arguments):
        result = browser_tool._run_browser_command(session, action, arguments, timeout=60)
        assert result.get('success'), f'{action}: {result}'
        return json.dumps(result, ensure_ascii=False)
    try:
        run('open', ['data:text/html,<title>CLINVEXA audit</title><label>Test<input id="test"></label>'])
        snapshot = run('snapshot', [])
        assert 'textbox' in snapshot
        run('fill', ['#test', 'SYNTHETIC-BROWSER-OK'])
        assert 'SYNTHETIC-BROWSER-OK' in run('get', ['value', '#test'])
        return {'chromium': str(chrome), 'driver': str(cli), 'productionBrowserTool': True, 'actualNavigationAndFill': True}
    finally:
        browser_tool.cleanup_browser(session)


check('bundled-browser-navigation-and-fill', browser)


def memory_roundtrip():
    from clinvexa.memory import CLINVEXAMemory, CLINVEXAMemoryRecord
    from tools.memory_tool import MemoryStore
    store = MemoryStore(memory_char_limit=20000, user_char_limit=20000)
    store.load_from_disk()
    memory = CLINVEXAMemory(store)
    identifier = 'SYN-RELEASE-MEMORY'
    try:
        memory.save(CLINVEXAMemoryRecord(content='合成验收：复诊提醒采用简短表达',
                    kind='patient_preference', record_id=identifier))
        restored_store = MemoryStore(memory_char_limit=20000, user_char_limit=20000)
        restored_store.load_from_disk()
        assert CLINVEXAMemory(restored_store).search(identifier)[0].record_id == identifier
        return {'savedReloadedAndSearched': True}
    finally:
        memory.delete(identifier)


def schedule_roundtrip():
    from cron.jobs import create_job, list_jobs, update_job, remove_job
    job = create_job(prompt='合成验收任务，不执行', schedule='0 0 1 1 *', name='SYN-RELEASE-SCHEDULE', deliver='local')
    try:
        update_job(job['id'], {'enabled': False, 'name': 'SYN-RELEASE-SCHEDULE-UPDATED'})
        restored = next(row for row in list_jobs(include_disabled=True) if row['id'] == job['id'])
        assert restored['name'].endswith('UPDATED') and not restored['enabled']
        return {'createdUpdatedReloaded': True, 'externalDelivery': False, 'jobExecuted': False}
    finally:
        assert remove_job(job['id'])


check('memory-persistence-and-search', memory_roundtrip)
check('scheduled-task-management', schedule_roundtrip)
sys.exit(0 if all(row['passed'] for row in checks) else 1)
