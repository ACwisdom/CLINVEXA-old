import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

import { _electron as electron } from 'playwright'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(desktopRoot, 'release', 'win-unpacked', 'CLINVEXA.exe')
const sandboxRoot = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(os.tmpdir(), 'clinvexa-install-verification-'))
const userDataDir = path.join(sandboxRoot, 'user-data')
const runtimeHome = path.join(sandboxRoot, 'runtime')
const logPath = path.join(runtimeHome, 'logs', 'desktop.log')

fs.mkdirSync(userDataDir, { recursive: true })
fs.mkdirSync(runtimeHome, { recursive: true })

const env = {
  ...process.env,
  CLINVEXA_PRODUCT_IDENTITY: '1',
  CLINVEXA_RUNTIME_HOME: runtimeHome,
  HERMES_DESKTOP_IGNORE_EXISTING: '1',
  HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1',
  HERMES_DESKTOP_USER_DATA_DIR: userDataDir,
  HERMES_HOME: runtimeHome
}
for (const key of Object.keys(env)) {
  if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key) ||
      ['ELECTRON_RUN_AS_NODE', 'HERMES_DESKTOP_PYTHON', 'HERMES_DESKTOP_HERMES_ROOT', 'PYTHONPATH', 'VIRTUAL_ENV', 'UV_PYTHON', 'UV_CACHE_DIR', 'UV_PROJECT_ENVIRONMENT', 'HERMES_GIT_BASH_PATH'].includes(key)) delete env[key]
}
env.PATH = [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot, path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0')].join(path.delimiter)
env.UV_OFFLINE = '1'
env.UV_PYTHON_DOWNLOADS = 'never'
env.PIP_NO_INDEX = '1'
env.HF_HUB_OFFLINE = '1'
env.HTTP_PROXY = 'http://127.0.0.1:9'
env.HTTPS_PROXY = 'http://127.0.0.1:9'
env.NO_PROXY = 'localhost,127.0.0.1'
console.log(`ISOLATED_INSTALL_ROOT=${sandboxRoot}`)

function log(message) {
  process.stdout.write(`[clinvexa-install-test] ${message}\n`)
}

function desktopLog() {
  try {
    return fs.readFileSync(logPath, 'utf8')
  } catch {
    return ''
  }
}

async function fetchJson(url, init = undefined) {
  const response = await fetch(url.replace('127.0.0.1:8001', '127.0.0.1:18127'), init)
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`CLINVEXA closure request failed (${response.status}): ${url}`)
  }
  return payload
}

async function verifyInstalledRuntimeClosure() {
  const sourceRoot = path.join(runtimeHome, 'hermes-agent')
  const python = path.join(sourceRoot, 'venv', 'Scripts', 'python.exe')
  const gatewaySource = path.join(sourceRoot, 'tui_gateway', 'server.py')
  const gatewayText = fs.readFileSync(gatewaySource, 'utf8')
  const contract = Number(gatewayText.match(/DESKTOP_BACKEND_CONTRACT\s*=\s*(\d+)/)?.[1] || 0)
  if (contract < 5) {
    throw new Error(`Packaged backend contract is too old: ${contract}`)
  }

  const importResult = execFileSync(
    python,
    [
      '-c',
      "import fastapi,faster_whisper,ctranslate2,av,numpy,sounddevice; " +
        "print(f'voice={faster_whisper.__version__};fastapi={fastapi.__version__}')"
    ],
    { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }
  ).trim()
  if (!importResult.includes('voice=1.2.1')) {
    throw new Error(`Chinese voice runtime import verification failed: ${importResult}`)
  }

  // Exercise the actual decoders and tools under this new runtime. A module
  // import from the developer machine is not a release acceptance result.
  execFileSync(python, [path.resolve(desktopRoot, '../../scripts/clinvexa_installed_runtime_audit.py'),
    '--home', runtimeHome,
    '--bundle', path.join(path.dirname(executablePath), 'resources/clinvexa-dependencies/clinvexa-live-voice'),
    '--output', path.join(sandboxRoot, 'runtime-engines.json')], {
    cwd: sourceRoot, env: {...env, PYTHONPATH: [path.join(sourceRoot, 'scripts'), path.join(sourceRoot, 'clinvexa/src'), sourceRoot].join(path.delimiter)},
    windowsHide: true, stdio: 'inherit', timeout: 600000
  })

  const skills = await fetchJson('http://127.0.0.1:8001/clinvexa/skills')
  if (!Array.isArray(skills) || skills.length !== 27) {
    throw new Error(`Expected 27 bundled CLINVEXA Skills, received ${Array.isArray(skills) ? skills.length : 'invalid'}`)
  }
  const deterministicSkills = new Set(['record-structuring', 'outpatient-note-draft', 'followup-plan'])
  const deterministicSource = path.join(sandboxRoot, 'clinvexa-deterministic-skill-sample.txt')
  fs.writeFileSync(
    deterministicSource,
    [
      '患者姓名：张明',
      '就诊日期：2026-08-14',
      '主诉：咳嗽3天，伴低热1天。',
      '现病史：3天前出现咳嗽，以干咳为主，偶有少量白痰；昨日体温最高37.8℃。',
      '既往史：否认高血压、糖尿病。',
      '过敏史：青霉素过敏，曾出现皮疹。',
      '用药史：本次就诊前未自行服药。',
      '检查检验：体温37.6℃，心率86次/分，呼吸18次/分，血氧饱和度98%；白细胞10.8×10^9/L，C反应蛋白18mg/L。',
      '初步判断：急性上呼吸道感染，待医生复核。',
      '处置建议：注意休息和补液，监测体温。',
      '随访计划：3天后复诊；如持续高热、胸痛或气促提前就医。'
    ].join('\n'),
    'utf8'
  )

  for (const skill of skills) {
    if (!skill.installed || !skill.enabled) {
      throw new Error(`Bundled Skill is not callable: ${skill.name}`)
    }
    const deterministic = deterministicSkills.has(skill.name)
    const invoked = await fetchJson(`http://127.0.0.1:8001/clinvexa/skills/${encodeURIComponent(skill.name)}/invoke`, {
      body: JSON.stringify({
        source_paths: deterministic ? [deterministicSource] : [],
        task: 'CLINVEXA 安装闭环测试'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    if (deterministic) {
      if (
        invoked?.mode !== 'deterministic' ||
        !Array.isArray(invoked?.output_paths) ||
        invoked.output_paths.length === 0 ||
        invoked.output_paths.some(outputPath => !fs.existsSync(outputPath))
      ) {
        throw new Error(`Deterministic Skill result is incomplete: ${skill.name}`)
      }
    } else if (typeof invoked?.invocation !== 'string' || !invoked.invocation.includes('CLINVEXA Skill')) {
      throw new Error(`Bundled Skill invocation is incomplete: ${skill.name}`)
    }
  }

  const consultationProbe = execFileSync(
    python,
    [
      '-c',
      "from clinvexa.consultations import analyze_consultation_transcript as a; " +
        "d=a('医生：哪里不舒服？患者：胸闷心悸两天。医生：有没有药物过敏？患者：青霉素。'); " +
        "assert '胸闷心悸两天' in d.chief_complaint and d.allergy_history == '青霉素过敏'; " +
        "print('CONSULTATION_PROTOCOL_OK')"
    ],
    {
      cwd: sourceRoot,
      encoding: 'utf8',
      env: { ...env, PYTHONPATH: [path.join(sourceRoot, 'clinvexa', 'src'), sourceRoot].join(path.delimiter) },
      windowsHide: true
    }
  ).trim()
  if (!consultationProbe.includes('CONSULTATION_PROTOCOL_OK')) {
    throw new Error('Consultation fixed-output protocol verification failed')
  }

  const text = desktopLog()
  if (/ModuleNotFoundError|"state":"failed"|bootstrap failed at stage/i.test(text)) {
    throw new Error('Fresh-install log contains a dependency or bootstrap failure')
  }
  log(`runtime closure passed: contract=${contract}, skills=${skills.length}, ${importResult}`)
}

async function waitForLog(pattern, timeoutMs, label, offset = 0) {
  const deadline = Date.now() + timeoutMs
  let lastLength = 0

  while (Date.now() < deadline) {
    const text = desktopLog().slice(offset)

    if (/"state":"failed"|bootstrap failed at stage/.test(text)) {
      throw new Error(`${label} failed; inspect ${logPath}`)
    }

    if (pattern.test(text)) {
      log(`${label}: confirmed`)
      return text
    }

    if (text.length !== lastLength) {
      lastLength = text.length
      const stageMatches = [...text.matchAll(/"name":"([^"]+)","state":"(running|succeeded|skipped|failed)"/g)]
      const latest = stageMatches.at(-1)
      if (latest) {
        log(`latest stage: ${latest[1]} / ${latest[2]}`)
      }
    }

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(`${label} was not observed within ${Math.round(timeoutMs / 1000)} seconds. Log: ${logPath}`)
}

async function launchAndChooseLocal() {
  const app = await electron.launch({ executablePath, env, timeout: 180_000 })
  const deadline = Date.now() + 60_000
  let localButton = null

  // CLINVEXA may create the movable floating-ball window before the main
  // workbench.  firstWindow() is therefore not guaranteed to be the setup
  // window; inspect every Electron window until the local-install action is
  // visible.
  while (Date.now() < deadline && !localButton) {
    // Current CLINVEXA packages are self-contained and automatically choose
    // the bundled local runtime.  Once bootstrap starts there is intentionally
    // no setup-choice button to click.
    if (/CLINVEXA packaged runtime selected|\[bootstrap\] starting at/.test(desktopLog())) {
      log(`packaged local installation started automatically; sandbox=${sandboxRoot}`)
      return app
    }
    for (const page of app.windows()) {
      const candidate = page
        .getByText(/Install CLINVEXA locally|Install Hermes locally|本地安装 CLINVEXA/)
        .first()
      if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
        localButton = candidate
        break
      }
    }
    if (!localButton) await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!localButton) {
    throw new Error('CLINVEXA neither auto-started bundled installation nor showed a local-install action')
  }
  await localButton.click()
  log(`local installation selected; sandbox=${sandboxRoot}`)
  return app
}

async function verifySecondLaunch() {
  const before = desktopLog().length
  const app = await electron.launch({ executablePath, env, timeout: 180_000 })
  await app.firstWindow()
  await waitForLog(/CLINVEXA backend is ready/, 120_000, 'second launch backend readiness', before)
  const appended = desktopLog().slice(before)

  if (/"name":"repository","state":"running"/.test(appended)) {
    throw new Error('Second launch unexpectedly re-entered the repository installation stage')
  }

  await app.close()
  log('second launch skipped repository installation')
}

let app
let isolatedService

try {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`CLINVEXA executable is missing: ${executablePath}`)
  }

  app = await launchAndChooseLocal()
  const completedLog = await waitForLog(/\[bootstrap\] bootstrap complete/, 35 * 60_000, 'first installation')

  if (!/"name":"repository","state":"skipped"/.test(completedLog)) {
    throw new Error('Bundled-source installation did not skip the upstream repository stage')
  }
  if (/"name":"repository","state":"failed"/.test(completedLog)) {
    throw new Error('Repository stage failed during bundled-source installation')
  }

  await waitForLog(/CLINVEXA backend is ready/, 3 * 60_000, 'first launch backend readiness')
  const sourceRoot = path.join(runtimeHome, 'hermes-agent')
  isolatedService = spawn(path.join(sourceRoot, 'venv/Scripts/python.exe'), ['-m', 'uvicorn', 'clinvexa.main:create_app', '--factory', '--host', '127.0.0.1', '--port', '18127'], {
    cwd: sourceRoot, windowsHide: true,
    env: { ...env, PYTHONPATH: [path.join(sourceRoot, 'clinvexa/src'), sourceRoot].join(path.delimiter) },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  isolatedService.stderr.on('data', chunk => fs.appendFileSync(path.join(sandboxRoot, 'isolated-service.log'), chunk))
  let serviceReady = false
  for (let attempt = 0; attempt < 90; attempt++) {
    try { await fetchJson('http://127.0.0.1:8001/clinvexa/skills'); serviceReady = true; break } catch { await new Promise(resolve => setTimeout(resolve, 1000)) }
  }
  if (!serviceReady) throw new Error('Isolated installed medical service did not start')
  await verifyInstalledRuntimeClosure()
  await app.close()
  app = null
  await verifySecondLaunch()
  log(`PASS; runtime=${runtimeHome}`)
  fs.writeFileSync(path.join(sandboxRoot, 'verification-result.json'), JSON.stringify({ passed: true, executablePath, runtimeHome, verified: ['bootstrap', 'bundled-python', 'voice-imports', '27-skills', 'deterministic-skill-outputs', 'consultation-protocol', 'second-launch'] }, null, 2))
} catch (error) {
  log(`FAIL: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  fs.writeFileSync(path.join(sandboxRoot, 'verification-result.json'), JSON.stringify({passed:false,executablePath,runtimeHome,error:String(error)},null,2))
  process.exitCode = 1
} finally {
  if (isolatedService) isolatedService.kill()
  if (app) {
    await app.close().catch(() => {})
  }
}
