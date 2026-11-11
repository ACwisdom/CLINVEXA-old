import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { _electron, chromium, expect } from '@playwright/test'

const desktop = path.resolve(import.meta.dirname, '..')
const evidenceRoot = path.resolve(desktop, '../../../.codex-work/voice-repair-20260918')
const executablePath = process.env.CLINVEXA_ACCEPTANCE_EXE
const home = process.env.CLINVEXA_ACCEPTANCE_RUNTIME_HOME
assert.ok(executablePath && home, 'Use a packaged executable and a verified installed runtime')
const out = path.join(evidenceRoot, 'visual-his-final')
fs.mkdirSync(out, {recursive:true})
const installedHome = path.join(process.env.APPDATA, 'CLINVEXA/runtime')
fs.copyFileSync(path.join(installedHome, 'config.yaml'), path.join(home, 'config.yaml'))
if (fs.existsSync(path.join(installedHome, '.env'))) fs.copyFileSync(path.join(installedHome, '.env'), path.join(home, '.env'))
const html = `<!doctype html><meta charset="utf-8"><title>CLINVEXA 合成HIS验收</title>
<style>body{font:20px 'Microsoft YaHei';padding:35px;max-width:850px;background:white;color:#162332}label{display:block;margin:20px 0}textarea{display:block;width:760px;height:65px;font:20px 'Microsoft YaHei'}</style>
<h1>合成病例 · 仅用于软件验收</h1><p>患者编号 TEST-204；姓名 测试小王；就诊编号 VISIT-204。</p>
<p id="source">主诉：咳嗽3天。现病史：三天前出现干咳，无发热，无胸痛，无呼吸困难。过敏史：青霉素过敏。</p>
<label>测试接收框甲<textarea id="a" aria-label="测试接收框甲"></textarea></label>
<label>不同名称接收框乙<textarea id="b" aria-label="不同名称接收框乙"></textarea></label>
<button onclick="document.querySelector('output').textContent='SUBMITTED'">正式提交（测试）</button><output></output>`
const server = http.createServer((req,res) => {res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});res.end(html)})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const env = {...process.env, HERMES_HOME:home, CLINVEXA_RUNTIME_HOME:home,
  HERMES_DESKTOP_USER_DATA_DIR:path.join(out,'desktop'), HERMES_DESKTOP_IGNORE_EXISTING:'1', HERMES_DESKTOP_SKIP_QUIT_CONFIRM:'1'}
for (const key of ['ELECTRON_RUN_AS_NODE','HERMES_DESKTOP_PYTHON','HERMES_DESKTOP_HERMES_ROOT','PYTHONPATH','VIRTUAL_ENV','HERMES_DESKTOP_DEV_SERVER']) delete env[key]
const proof = {synthetic:true, passed:false, checks:[], timings:[]}
const foregroundScript = String.raw`
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class TestForeground {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int capacity);
}
"@
$target = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like '*CLINVEXA 合成HIS验收*' } | Select-Object -First 1
if (-not $target) {
  'NO TARGET: ' + ((Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + '=' + $_.MainWindowTitle }) -join '; ')
  exit
}
if ($target) {
  [void][TestForeground]::ShowWindowAsync($target.MainWindowHandle, 9)
  [void](New-Object -ComObject WScript.Shell).AppActivate($target.Id)
  [void][TestForeground]::SetForegroundWindow($target.MainWindowHandle)
}
Start-Sleep -Milliseconds 100
$buffer = [System.Text.StringBuilder]::new(1024)
[void][TestForeground]::GetWindowText([TestForeground]::GetForegroundWindow(), $buffer, 1024)
$buffer.ToString()
`
function focusHIS() {
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',foregroundScript],{encoding:'utf8',timeout:10000}).trim()
}
let app, browser, telemetryTimer
const telemetry = []
try {
  app = await _electron.launch({executablePath, env, timeout:180000})
  proof.version = await app.evaluate(({app}) => app.getVersion())
  await expect.poll(() => app.windows().some(page => page.url().includes('win=clinvexa')), {timeout:180000}).toBe(true)
  const ball = app.windows().find(page => page.url().includes('win=clinvexa'))
  await ball.evaluate(() => window.hermesDesktop.getConnection())
  await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.setExpanded(true))
  telemetryTimer = setInterval(async () => {
    try {
      const sample = await ball.evaluate(async () => ({
        copilot: await window.hermesDesktop.CLINVEXACopilot.getState(),
        screen: await window.hermesDesktop.CLINVEXAScreen.getState()
      }))
      telemetry.push({at: Date.now(), status: sample.copilot.status, enabled: sample.copilot.enabled,
        frameId: sample.copilot.frameId, resultId: sample.copilot.result?.id,
        screenStatus: sample.screen.status, observedAt: sample.screen.context?.observedAt,
        capturedAt: sample.screen.context?.capturedAt, targetTitle: sample.screen.context?.title, error: sample.screen.error})
    } catch {}
  }, 250)
  const browserRoot = path.join(home,'ms-playwright')
  const chrome = path.join(browserRoot, fs.readdirSync(browserRoot).find(name => /^chromium-\d+$/.test(name)), 'chrome-win64/chrome.exe')
  browser = await chromium.launch({executablePath:chrome,headless:false,args:['--force-renderer-accessibility','--window-position=0,0','--window-size=1050,950']})
  const his = await browser.newPage({viewport:{width:1000,height:850}})
  await his.goto(`http://127.0.0.1:${server.address().port}`)
  let state
  for (const duration of [3,4,5]) {
    await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.setEnabled(false))
    const previousId = (await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.getState())).result?.id
    await his.locator('#source').evaluate((element,days) => {
      element.textContent=`主诉：咳嗽${days}天。现病史：${days}天前出现干咳，无发热，无胸痛，无呼吸困难。过敏史：青霉素过敏。`
    },duration)
    await his.bringToFront()
    let foregroundTitle = ''
    for (let attempt=0; attempt<3; attempt++) {
      foregroundTitle = focusHIS()
      if (foregroundTitle.includes('CLINVEXA 合成HIS验收')) break
      await his.bringToFront()
    }
    assert.ok(foregroundTitle.includes('CLINVEXA 合成HIS验收'), `HIS focus precondition failed: ${foregroundTitle}`)
    const started = Date.now()
    await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.setEnabled(true))
    await expect.poll(() => ball.evaluate(previousId => window.hermesDesktop.CLINVEXACopilot.getState().then(row => row.status==='ready' && row.result?.id!==previousId),previousId), {timeout:45000,intervals:[100]}).toBe(true)
    state = await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.getState())
    const wallMs = Date.now()-started
    const screenState = await ball.evaluate(() => window.hermesDesktop.CLINVEXAScreen.getState())
    const captureTiming = screenState.context ? {
      captureMs: screenState.context.latencyMs,
      beforeCaptureMs: screenState.context.observedAt-started,
      beforeModelMs: state.result.capturedAt-started
    } : null
    fs.writeFileSync(path.join(out,`analysis-${duration}.json`),JSON.stringify(state,null,2))
    await his.screenshot({path:path.join(out,`source-${duration}.png`)})
    assert.ok(state.target?.title?.includes('合成HIS'), 'Wrong foreground window analyzed')
    assert.ok(state.result.suggestions.some(item => item.text.includes('咳嗽')))
    const extracted = state.result.suggestions.map(item => item.text).join('\n')
    assert.ok(extracted.includes(`${duration}天`), 'Consultation duration lost or stale')
    assert.ok(extracted.includes('青霉素') && /无发热|否认发热|未出现发热/.test(extracted), 'Allergy or negative finding lost')
    proof.timings.push({case:'actual-screen-capture-to-result-'+duration,wallMs,deliveryMs:state.result.deliveryMs,captureTiming})
  }
  proof.checks.push('real-screenshot-and-configured-visual-model')
  await ball.getByRole('button', {name:'保留本结果可实现快捷填写',exact:true}).click()
  const retained = state.result.id
  const item = state.result.suggestions.find(row => row.text.includes('咳嗽'))
  for (const label of ['测试接收框甲','不同名称接收框乙']) {
    await his.getByRole('textbox', {name:label,exact:true}).click()
    await expect.poll(() => ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.getState().then(row => row.fillMode && row.enabled)), {timeout:10000}).toBe(true)
    const card = ball.getByRole('article', {name:item.title,exact:true})
    await card.getByRole('button', {name:'快捷填写',exact:true}).click()
    await expect(his.getByRole('textbox', {name:label,exact:true})).toHaveValue(item.text, {timeout:15000})
    const current = await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.getState())
    assert.equal(current.result.id, retained)
    proof.checks.push('retained-result-to-focused-field:' + label)
  }
  assert.equal(await his.locator('output').textContent(), '')
  proof.checks.push('no-unrequested-form-submission')
  await his.screenshot({path:path.join(out,'filled-his.png')})
  await ball.screenshot({path:path.join(out,'retained-result.png')})
  await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.setEnabled(false))
  const pausedScreen = await ball.evaluate(() => window.hermesDesktop.CLINVEXAScreen.getState())
  await his.locator('#source').evaluate(element => {element.textContent='暂停期间的合成测试改动，不应读取。'})
  await new Promise(resolve=>setTimeout(resolve,1200))
  const afterPause = await ball.evaluate(() => window.hermesDesktop.CLINVEXAScreen.getState())
  assert.equal(afterPause.status,'paused')
  assert.equal(afterPause.context?.capturedAt,pausedScreen.context?.capturedAt)
  proof.checks.push('pause-does-not-capture-new-screen-content')
  state = await ball.evaluate(() => window.hermesDesktop.CLINVEXACopilot.getState())
  assert.equal(state.result.id, retained)
  proof.checks.push('pause-retains-result')
  proof.passed = true
  proof.performancePassed = proof.timings.every(row => row.wallMs <= 10000)
} catch (error) {proof.error=String(error);process.exitCode=1}
finally {
  if (telemetryTimer) clearInterval(telemetryTimer)
  fs.writeFileSync(path.join(out,'telemetry.json'),JSON.stringify(telemetry,null,2))
  if (app) {
    const ball=app.windows().find(page=>page.url().includes('win=clinvexa'))
    await ball?.evaluate(() => window.hermesDesktop.CLINVEXACopilot.setEnabled(false)).catch(()=>{})
  }
  await browser?.close();await app?.close();server.close()
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(proof,null,2))
  console.log(JSON.stringify(proof,null,2))
}
