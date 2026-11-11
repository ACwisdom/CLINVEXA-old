/** Native Electron IPC + real local ASR; synthetic audio only, no HIS page. */
import fs from 'node:fs'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const packagedExe = process.env.CLINVEXA_ACCEPTANCE_EXE
if (!packagedExe) throw new Error('Acceptance requires the installed CLINVEXA executable; development ASR is not permitted')
const installedHome = path.join(process.env.APPDATA, 'CLINVEXA/runtime')
const verifiedRuntime = process.env.CLINVEXA_ACCEPTANCE_RUNTIME_HOME || installedHome
const installedPython = path.join(verifiedRuntime, 'hermes-agent/venv/Scripts/python.exe')
const runtimeSource = packagedExe ? path.join(path.dirname(packagedExe), 'resources/clinvexa-runtime') : repo
const output = path.resolve(repo, '../.codex-work/voice-repair-20260918/native-packaged')
fs.mkdirSync(output, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(output, 'run-'))
if (!process.env.CLINVEXA_ACCEPTANCE_RUNTIME_HOME) throw new Error('Use the complete isolated offline-verified runtime')
const home = verifiedRuntime, userData = path.join(sandbox, 'desktop')
fs.mkdirSync(userData)
fs.copyFileSync(path.join(installedHome, 'config.yaml'), path.join(home, 'config.yaml'))
if (fs.existsSync(path.join(installedHome, '.env'))) fs.copyFileSync(path.join(installedHome, '.env'), path.join(home, '.env'))
// This is the complete independently offline-installed runtime, including both
// voice engines, native driver and models. No developer interpreter or models.
const wave = path.join(path.dirname(packagedExe), 'resources/clinvexa-dependencies/clinvexa-live-voice/smoke.wav')
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value && !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(key)))
delete env.ELECTRON_RUN_AS_NODE
delete env.HERMES_DESKTOP_IS_PACKAGED
for (const key of ['HERMES_DESKTOP_PYTHON','HERMES_DESKTOP_HERMES_ROOT','PYTHONPATH','VIRTUAL_ENV','HERMES_DESKTOP_DEV_SERVER']) delete env[key]
let app
const evidence = { synthetic: true, sandbox, steps: [] }
try {
  if (await fetch('http://127.0.0.1:8001/clinvexa/health').then(() => true).catch(() => false)) throw new Error('Close the existing CLINVEXA before isolated acceptance; never reuse another runtime service')
  app = await _electron.launch({ executablePath: packagedExe || path.join(repo, 'node_modules/electron/dist/electron.exe'), args: [...(packagedExe ? [] : [desktop]), '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wave}`], cwd: desktop,
    env: { ...env, HERMES_HOME: home, CLINVEXA_RUNTIME_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: userData, HERMES_DESKTOP: '1', HERMES_DESKTOP_IGNORE_EXISTING: '1', HERMES_DESKTOP_APP_NAME: 'CLINVEXALiveAcceptance', CLINVEXA_DESKTOP: '1', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1', HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS: '300000' }, timeout: 120000 })
  app.process().stdout?.on('data', chunk => fs.appendFileSync(path.join(sandbox, 'app.log'), chunk))
  evidence.version = await app.evaluate(({app}) => app.getVersion())
  app.process().stderr?.on('data', chunk => fs.appendFileSync(path.join(sandbox, 'app.log'), chunk))
  await expect.poll(() => app.windows().some(page => page.url().includes('win=clinvexa')), { timeout: 300000 }).toBe(true)
  const ball = app.windows().find(page => page.url().includes('win=clinvexa'))
  await expect.poll(async () => {
    try {return await ball.evaluate(() => window.hermesDesktop.api({path: '/api/clinvexa/platform/status', method: 'GET'}))}
    catch {return null}
  }, {timeout: 120000}).toMatchObject({connected: false, execution: 'clinvexa'})
  evidence.steps.push({name: 'packaged-platform-account-api'})
  await expect.poll(async () => (await fetch('http://127.0.0.1:8001/clinvexa/voice/status').then(r => r.json()).catch(() => ({ ready: false }))).ready, { timeout: 360000 }).toBe(true)
  await ball.getByRole('button', { name: '打开 CLINVEXA', exact: true }).click({ timeout: 120000 })
  await ball.getByRole('button', { name: '问诊记录', exact: true }).click()
  await ball.getByLabel('患者编号', { exact: true }).fill('SYNTHETIC-NATIVE')
  await ball.getByLabel('患者已知情并同意本次问诊记录。').check()
  // This test measures local recording and shared state. It does not send the
  // user's other windows to any provider or claim visual-model performance.
  await ball.getByLabel(/同时开启屏幕辅助/).uncheck()
  const started = Date.now()
  await ball.getByRole('button', { name: '开始问诊记录', exact: true }).click()
  await expect(ball.getByRole('log', { name: '问诊转写' })).toContainText('头痛', { timeout: 60000 })
  evidence.steps.push({ name: 'native-audio-to-visible-transcript', milliseconds: Date.now() - started })
  const initial = await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState())
  await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.openSidebar('skills'))
  await expect.poll(async () => (await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.record?.segments?.length, { timeout: 20000 }).toBeGreaterThan(initial.record.segments.length)
  evidence.steps.push({ name: 'recording-survives-workspace-navigation' })
  let maxPending = 0
  for (let sample = 0; sample < 12; sample++) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    const state = await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState())
    if (state.status !== 'recording') throw new Error('Recording stopped without a user stop action')
    maxPending = Math.max(maxPending, state.pending)
    if (state.pending > 12) throw new Error('ASR queue grew beyond one minute of audio')
  }
  evidence.steps.push({name:'continuous-recording-one-minute', maxPending})
  await ball.getByRole('button', { name: '结束并核对草稿', exact: true }).click()
  await expect.poll(async () => (await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.status, { timeout: 45000 }).toBe('ready')
  await expect.poll(async () => (await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.record?.analysis_mode, { timeout: 90000 }).toBe('ai')
  const final = await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState())
  if (final.record.id !== initial.record.id || final.pending !== 0) throw new Error('Session identity or final audio queue mismatch')
  evidence.steps.push({ name: 'native-command-mirror-and-finalize', segments: final.record.segments.length })
  if (!final.record.draft_fields?.some(field => field.status === 'present' && field.value.includes('头痛'))) throw new Error('AI draft did not include spoken symptoms')
  evidence.steps.push({ name: 'real-transcript-to-structured-ai-draft', fields: final.record.draft_fields.filter(field => field.status === 'present').map(field => field.key) })
  await ball.screenshot({ path: path.join(output, 'floating-real-asr.png'), timeout: 60000 })
  const main = app.windows().find(page => page.url().includes('index.html') && !page.url().includes('win='))
  if (!main) throw new Error('Main workbench is missing')
  // CDP pointer coordinates drift in Electron at the host's Windows scaling.
  // Exercise the accessible button action; native mouse verification is separate.
  const summon = main.getByRole('button', {name: '副驾驶悬浮球', exact: true})
  await expect(summon).toBeVisible({timeout: 30000})
  for (const scenario of ['hidden', 'outside-display', 'closed']) {
    await app.evaluate(({BrowserWindow}, scenario) => {
      const window = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('win=clinvexa'))
      if (!window) throw new Error('No floating window before recovery scenario')
      if (scenario === 'hidden') window.hide()
      else if (scenario === 'outside-display') window.setPosition(-20000, -20000)
      else window.close()
    }, scenario)
    await summon.focus(); await summon.press('Enter')
    await expect.poll(() => app.evaluate(({BrowserWindow, screen}) => {
      const window = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('win=clinvexa'))
      if (!window || !window.isVisible()) return false
      const bounds = window.getBounds(), area = screen.getDisplayMatching(bounds).workArea
      return bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width
        && bounds.y + bounds.height <= area.y + area.height && window.isAlwaysOnTop()
    }), {timeout:30000}).toBe(true)
    await expect.poll(() => app.windows().some(page => page.url().includes('win=clinvexa')), {timeout:30000}).toBe(true)
    const recovered = app.windows().find(page => page.url().includes('win=clinvexa'))
    await expect(recovered.getByRole('button', {name:'打开 CLINVEXA',exact:true})).toBeVisible({timeout:30000})
    evidence.steps.push({name: 'summon-floating-ball-' + scenario})
  }
  const reopened = app.windows().find(page => page.url().includes('win=clinvexa'))
  await reopened.getByRole('button', {name:'打开 CLINVEXA',exact:true}).click()
  await expect(reopened.getByRole('button', {name:'收起助手',exact:true})).toBeVisible()
  evidence.steps.push({name:'summoned-ball-is-interactive'})
  await main.screenshot({path:path.join(output,'main-summon-entry.png')})
  evidence.passed = true
 } catch (error) {
  evidence.passed = false; evidence.error = String(error); process.exitCode = 1
  evidence.windows = app?.windows().map(page => page.url())
  const failedBall = app?.windows().find(page => page.url().includes('win=clinvexa')) || app?.windows()[0]
  if (failedBall) {
    await failedBall.screenshot({path: path.join(output, 'failure.png'),timeout:10000}).catch(()=>{})
    fs.writeFileSync(path.join(output, 'failure.txt'), await failedBall.locator('body').innerText().catch(()=>''))
  }
}
finally {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
  await app?.close()
}
