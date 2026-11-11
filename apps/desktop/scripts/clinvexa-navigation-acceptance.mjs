/** Real desktop navigation only: no recording, screen capture, HIS or patient input. */
import fs from 'node:fs'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const executable = process.env.CLINVEXA_ACCEPTANCE_EXE
const output = path.resolve(repo, '../.codex-work/nav-unification-20260914', executable ? 'packaged' : 'native')
fs.mkdirSync(output, {recursive: true})
const sandbox = fs.mkdtempSync(path.join(output, 'run-'))
const home = path.join(sandbox, 'home'), userData = path.join(sandbox, 'desktop')
fs.mkdirSync(home); fs.mkdirSync(userData)
fs.writeFileSync(path.join(home, 'config.yaml'), JSON.stringify({model: {provider: 'custom', default: 'navigation-test', base_url: 'http://127.0.0.1:1/v1', api_key: 'local-test'}, display: {language: 'zh'}, stt: {enabled: false}}))
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value && !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(key)))
delete env.ELECTRON_RUN_AS_NODE; delete env.HERMES_DESKTOP_IS_PACKAGED; delete env.HERMES_DESKTOP_DEV_SERVER
const evidence = {sandbox, steps: [], passed: false}
// Keyboard activation avoids Electron/CDP pointer-coordinate drift under the
// host's Windows scaling, and exercises the actual accessible button handler.
async function activate(locator) {await locator.focus(); await locator.press('Enter')}
let app, main
try {
  app = await _electron.launch({executablePath: executable || path.join(repo, 'node_modules/electron/dist/electron.exe'), args: [...(executable ? [] : [desktop]), '--disable-gpu'], cwd: desktop,
    env: {...env, HERMES_HOME: home, CLINVEXA_RUNTIME_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: userData,
      HERMES_DESKTOP_HERMES_ROOT: executable ? path.join(path.dirname(executable), 'resources/clinvexa-runtime') : repo,
      HERMES_DESKTOP: '1', CLINVEXA_DESKTOP: '1', HERMES_DESKTOP_PYTHON: path.join(repo, '.venv/Scripts/python.exe'),
      HERMES_DESKTOP_IGNORE_EXISTING: '1', HERMES_DESKTOP_APP_NAME: 'CLINVEXANavigationAcceptance', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1'}, timeout: 120000})
  app.process().stdout?.on('data', chunk => fs.appendFileSync(path.join(sandbox, 'app.log'), chunk))
  app.process().stderr?.on('data', chunk => fs.appendFileSync(path.join(sandbox, 'app.log'), chunk))
  await expect.poll(() => app.windows().some(page => page.url().includes('index.html') && !page.url().includes('win=')), {timeout: 120000}).toBe(true)
  main = app.windows().find(page => page.url().includes('index.html') && !page.url().includes('win='))
  await app.evaluate(({BrowserWindow}) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.getURL().includes('win=')) {win.webContents.setZoomFactor(1); win.setSize(1400,950)}
    }
  })
  await expect.poll(async () => {
    try {return await main.evaluate(() => window.hermesDesktop.api({path:'/api/clinvexa/platform/status', method:'GET'}))}
    catch {return null}
  }, {timeout:240000}).toMatchObject({connected:false})
  await expect(main.getByRole('button', {name:'定时任务', exact:true})).toBeVisible({timeout:120000})
  await expect(main.locator('.z-\\(--z-onboarding\\)')).toHaveCount(0, {timeout:120000})
  await expect(main.getByRole('button', {name: '医疗智能体', exact: true})).toBeVisible({timeout: 180000})
  const names = ['视觉副驾驶', '问诊记录', '医疗智能体', '任务进度', '桌面操作']
  const nav = main.locator('[data-sidebar="menu"]').filter({has: main.getByRole('button', {name:'定时任务', exact:true})})
  const labels = await nav.getByRole('button').allTextContents()
  const start = labels.findIndex(label => label.trim() === '定时任务')
  if (start < 0 || JSON.stringify(labels.slice(start + 1, start + 6).map(label => label.trim())) !== JSON.stringify(names)) throw new Error(`Main navigation order mismatch: ${JSON.stringify(labels)}`)
  for (const name of names) {
    await activate(nav.getByRole('button', {name, exact: true}))
    await expect(nav.getByRole('button', {name, exact: true})).toHaveAttribute('aria-current', 'page')
    await expect(main.locator('.dc-main-page-host > .dc-main-page')).toBeVisible()
    await expect(main.getByRole('button', {name:'定时任务', exact:true})).toBeVisible()
    await expect(main.locator('.dc-unified, .dc-unified-nav')).toHaveCount(0)
    if (name === '医疗智能体') {
      await expect(main.getByRole('heading', {name, exact:true})).toBeVisible()
      await main.screenshot({path:path.join(output,'medical-agents.png')})
    }
    if (name === '问诊记录') await main.screenshot({path:path.join(output,'consultation.png')})
    evidence.steps.push(`main-sidebar:${name}`)
  }
  const ball = app.windows().find(page => page.url().includes('win=clinvexa'))
  await expect(ball.getByRole('button', {name:'打开 CLINVEXA', exact:true})).toBeVisible({timeout:120000})
  await activate(ball.getByRole('button', {name:'打开 CLINVEXA', exact:true}))
  const windowsBefore = app.windows().length
  await activate(ball.getByRole('button', {name:'打开工作台', exact:true}))
  await expect(nav.getByRole('button', {name:'视觉副驾驶', exact:true})).toHaveAttribute('aria-current','page')
  await expect(main.locator('.dc-main-page-host .dc-workbench-embedded')).toBeVisible()
  if (app.windows().length !== windowsBefore) throw new Error('Floating workbench opened another window')
  await main.screenshot({path:path.join(output,'floating-to-main.png')})
  await activate(ball.getByRole('button', {name:'医疗智能体', exact:true}))
  await expect(nav.getByRole('button', {name:'医疗智能体', exact:true})).toHaveAttribute('aria-current','page')
  evidence.steps.push('floating-workbench-opens-main-route', 'floating-agents-opens-main-route', 'no-second-workbench-window')
  evidence.passed = true
} catch (error) {
  evidence.error = String(error); process.exitCode = 1
  await main?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})
  if (main) fs.writeFileSync(path.join(output,'failure.txt'), await main.locator('body').innerText().catch(()=>''))
} finally {
  fs.writeFileSync(path.join(output,'result.json'), JSON.stringify(evidence,null,2))
  console.log(JSON.stringify(evidence))
  await app?.close()
}
