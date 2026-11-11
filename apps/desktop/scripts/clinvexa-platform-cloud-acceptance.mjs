/** Real desktop navigation only: no recording, screen capture, HIS or patient input. */
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { _electron, expect } from '@playwright/test'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const executable = process.env.CLINVEXA_ACCEPTANCE_EXE
const output = path.resolve(repo, '../.codex-work/platform-link-20260915/native', executable ? 'packaged' : 'native')
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
      HERMES_DESKTOP_IGNORE_EXISTING: '1', HERMES_DESKTOP_APP_NAME: 'CLINVEXAPlatformAcceptance', HERMES_DESKTOP_SKIP_QUIT_CONFIRM: '1'}, timeout: 120000})
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
  const base = 'https://43.138.188.149:8443'
  const credentials = {email: `clinvexa-link-qa-${crypto.randomUUID()}@example.invalid`, password: crypto.randomBytes(20).toString('hex')}
  const registration = await fetch(`${base}/api/v1/auth/register`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(credentials)})
  if (registration.status !== 201) throw new Error(`QA registration status: ${registration.status}`)
  const anonymous = await fetch(`${base}/api/v1/desktop/capabilities`)
  expect(anonymous.status).toBe(401)
  await activate(main.getByRole('button', {name:'医疗智能体', exact:true}))
  await activate(main.getByRole('button', {name:'平台智能体', exact:true}))
  await main.getByLabel('平台地址', {exact:true}).fill(base)
  await main.getByLabel('平台账户', {exact:true}).fill(credentials.email)
  await main.getByLabel('密码', {exact:true}).fill(credentials.password)
  await activate(main.getByRole('button', {name:'使用平台账号登录', exact:true}))
  const sync = main.getByRole('button', {name:'同步已安装能力', exact:true})
  await expect(sync).toBeEnabled({timeout:60000})
  await expect(main.getByText('尚无可见的已安装能力。请先在平台安装智能体或 Skill，再同步。', {exact:true})).toBeVisible()
  await expect(main.locator('.dc-platform-connect')).toHaveCount(0)
  await expect(main.getByRole('alert')).toHaveCount(0)
  const status = await main.evaluate(() => window.hermesDesktop.api({path:'/api/clinvexa/platform/status',method:'GET'}))
  expect(status).toMatchObject({connected:true,url:base,execution:'clinvexa'})
  const catalog = await main.evaluate(() => window.hermesDesktop.api({path:'/api/clinvexa/platform/agents',method:'GET'}))
  expect(catalog.items).toEqual([])
  await activate(sync)
  await expect(sync).toBeEnabled()
  evidence.connection = {connected:status.connected, url:status.url, execution:status.execution, catalogItems:catalog.items.length}
  await activate(main.getByRole('button', {name:'退出平台账号', exact:true}))
  await expect(main.getByRole('button', {name:'使用平台账号登录', exact:true})).toBeVisible()
  evidence.steps.push('trusted-https-qa-registration','anonymous-capabilities-401','packaged-ui-cloud-login','real-installed-catalog-query','manual-sync','logout')
  evidence.emptyTestAccount = true
  evidence.passed = true
} catch (error) {
  evidence.error = String(error); process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(output,'result.json'), JSON.stringify(evidence,null,2))
  console.log(JSON.stringify(evidence))
  await app?.close()
}