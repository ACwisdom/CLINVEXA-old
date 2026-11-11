/** Real Electron capture and configured-model analysis, synthetic audio only. */
import fs from 'node:fs'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const output = path.resolve(repo, '../.codex-work/consultation-v16-20260915')
const home = path.join(output, 'native-shell-home')
fs.mkdirSync(home, { recursive: true })
fs.writeFileSync(path.join(home, 'config.yaml'), JSON.stringify({ model: { provider: 'custom', default: 'synthetic-ui', base_url: 'http://127.0.0.1:1/v1', api_key: 'synthetic-only' }, display: { language: 'zh' }, stt: { enabled: false } }))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value && !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(key)))
delete env.ELECTRON_RUN_AS_NODE; delete env.HERMES_DESKTOP_IS_PACKAGED; delete env.HERMES_DESKTOP_DEV_SERVER
const executable = process.env.CLINVEXA_ACCEPTANCE_EXE
const evidence = { synthetic: true, steps: [], passed: false }
async function activate(locator) {await locator.focus(); await locator.press('Enter')}
let app, main
try {
  app = await _electron.launch({ executablePath: executable || path.join(repo, 'node_modules/electron/dist/electron.exe'),
    args: [...(executable ? [] : [desktop]), '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${path.join(output, 'synthetic-dialogue.wav')}`], cwd: desktop,
    env: { ...env, HERMES_HOME: home, CLINVEXA_RUNTIME_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: path.join(output, 'native-desktop'),
      HERMES_DESKTOP_HERMES_ROOT: executable ? path.join(path.dirname(executable), 'resources/clinvexa-runtime') : repo,
      HERMES_DESKTOP: '1', CLINVEXA_DESKTOP: '1', HERMES_DESKTOP_PYTHON: path.join(repo, '.venv/Scripts/python.exe'),
      HERMES_DESKTOP_IGNORE_EXISTING: '1', HERMES_DESKTOP_APP_NAME: 'CLINVEXAV16Acceptance', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1' }, timeout: 120000 })
  // Isolate medical requests from the doctor's existing service and records.
  await app.context().route('http://127.0.0.1:8001/**', route => route.continue({ url: route.request().url().replace(':8001/', ':8106/') }))
  app.process().stderr?.on('data', chunk => fs.appendFileSync(path.join(output, 'native-app.log'), chunk))
  await expect.poll(() => app.windows().some(page => page.url().includes('index.html') && !page.url().includes('win=')), { timeout: 120000 }).toBe(true)
  main = app.windows().find(page => page.url().includes('index.html') && !page.url().includes('win='))
  await app.evaluate(({ BrowserWindow }) => {for (const win of BrowserWindow.getAllWindows()) {if (!win.webContents.getURL().includes('win=')) {win.webContents.setZoomFactor(1); win.setSize(1400, 950)}}})
  const nav = main.locator('[data-sidebar="menu"]').filter({ has: main.getByRole('button', { name: '定时任务', exact: true }) })
  await expect(nav.getByRole('button', { name: '问诊记录', exact: true })).toBeVisible({ timeout: 240000 })
  await activate(nav.getByRole('button', { name: '问诊记录', exact: true }))
  await expect(main.getByLabel('问诊语言')).toBeVisible()
  // Mandarin capture; dialect recognition has separate benchmarks.


  await main.getByLabel('问诊语言').selectOption('auto')
  await main.getByLabel('患者编号', { exact: true }).fill('SYNTHETIC-V16')
  await main.getByLabel('患者已知情并同意本次问诊记录。').focus(); await main.getByLabel('患者已知情并同意本次问诊记录。').press('Space')
  await main.getByLabel(/同时开启屏幕辅助/).focus(); await main.getByLabel(/同时开启屏幕辅助/).press('Space')
  const start = Date.now()
  await expect(main.getByRole('button', { name: '开始问诊记录', exact: true })).toBeEnabled({ timeout: 60000 })
  await activate(main.getByRole('button', { name: '开始问诊记录', exact: true }))
  await expect.poll(async () => (await main.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.record?.transcript?.length ?? 0, { timeout: 30000 }).toBeGreaterThan(0)
  evidence.steps.push({ name: 'first-visible-transcript', ms: Date.now() - start })
  await expect.poll(async () => (await main.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.analysisProgress?.some(line => line.includes('已提取')), { timeout: 45000 }).toBe(true)
  evidence.steps.push({ name: 'streamed-grounded-facts', ms: Date.now() - start })
  await main.screenshot({ path: path.join(output, 'streaming-consultation.png') })
  await expect(main.getByRole('log', { name: '问诊转写' })).toContainText('青霉素', { timeout: 40000 })
  await expect(main.getByRole('log', { name: '问诊转写' })).toContainText('没有长期用药', { timeout: 60000 })
  await activate(main.getByRole('button', { name: '结束并核对草稿', exact: true }))
  await expect.poll(async () => {const s = await main.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()); return s?.status === 'ready' && !s?.analyzing}, { timeout: 90000 }).toBe(true)
  const final = await main.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState())
  if (final.analysisError || final.record.analysis_mode !== 'ai' || !final.record.suggestions?.length || !final.draft.includes('腹痛')) {throw new Error('Consultation draft or suggestions incomplete')}
  fs.writeFileSync(path.join(output, 'final-state.json'), JSON.stringify(final, null, 2));
  if (!final.record.draft?.present_illness?.match(/39|三十九/) || !final.record.draft?.allergy_history?.includes('青霉素') || !final.record.draft?.medication_history?.match(/无|未|没有/)) {throw new Error('Missing required fever/allergy/medication facts')}
  if (!final.record.transcript.includes('有没有发烧')) {throw new Error('ASR lost the question prefix')}
  if (!final.record.analysis_turns?.some(turn => turn.role === '医生') || !final.record.analysis_turns?.some(turn => turn.role === '患者')) {throw new Error('Missing semantic roles')}
  evidence.steps.push({ name: 'AI-draft-and-suggestions', segments: final.record.segments.length, suggestions: final.record.suggestions.length })
  await main.getByLabel('病历草稿', { exact: true }).fill('医生已核对的合成测试病历。')
  await activate(main.getByRole('button', { name: '保存草稿', exact: true }))
  const ball = app.windows().find(page => page.url().includes('win=clinvexa'))
  if (!ball) {throw new Error('Floating assistant unavailable')}
  await ball.evaluate(() => window.hermesDesktop.CLINVEXAWindow.commandConsultation({ type: 'analyze' }))
  await expect.poll(async () => (await main.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.analyzing, { timeout: 5000 }).toBe(true)
  await expect.poll(async () => (await main.evaluate(() => window.hermesDesktop.CLINVEXAWindow.getConsultationState()))?.analyzing, { timeout: 60000 }).toBe(false)
  await expect(main.getByLabel('病历草稿', { exact: true })).toHaveValue('医生已核对的合成测试病历。')
  await expect(main.getByRole('button', { name: '选择并复制' }).first()).toBeEnabled()
  await activate(main.getByRole('button', { name: '选择并复制' }).first())
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
  if (!clipboard.trim()) {throw new Error('Selected suggestion did not reach clipboard')}
  evidence.steps.push('floating IPC reanalysis; physician edits preserved; selected suggestion copied')
  await main.screenshot({ path: path.join(output, 'completed-consultation.png') })
  evidence.passed = true
} catch (error) {
  evidence.error = String(error); process.exitCode = 1
  if (main) {await main.screenshot({ path: path.join(output, 'native-failure.png') }).catch(() => {}); fs.writeFileSync(path.join(output, 'native-failure.txt'), await main.locator('body').innerText().catch(() => ''))}
} finally {
  fs.writeFileSync(path.join(output, 'native-result.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence))
  await app?.close()
}

