import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { build } from 'vite'
import { chromium, expect } from '@playwright/test'

const desktop = process.cwd()
const output = path.resolve(desktop, '../../../.codex-work/upgrade-20260914/ui')
fs.mkdirSync(output, { recursive: true })
const stem = `.clinvexa-preview-${Date.now()}`
const entry = path.join(desktop, `${stem}.tsx`)
const html = path.join(desktop, `${stem}.html`)
const fixture = { id: 'screen-test', taskKey: 'a'.repeat(64), frameId: 'frame', windowId: 'test', processName: 'test', title: '软件验收 · 合成病例资料', capturedAt: Date.now(), createdAt: Date.now(), latencyMs: 1800, patientId: 'SYNTH-01', patientName: '合成测试患者', encounterId: 'VISIT-01', scene: 'record', summary: '当前正在补充门诊病历，可将本次问诊的主诉和现病史整理后快捷填写。', facts: ['患者自述咳嗽三天。', '过敏史仍需核对。'], missing: ['尚未提供体温与血氧。'], suggestions: [{ id: 's1', kind: 'field', title: '主诉', text: '咳嗽3天。', reason: '根据本次合成问诊转写。', evidence: ['患者：咳嗽三天。'], sourceIds: [], cautions: [], targetLabel: '主诉' }], sources: [], question: '', draft: '', revision: 0 }
const state = { enabled: true, expanded: true, status: 'ready', error: null, frameId: 'frame', result: fixture, stale: false, startedAt: null, target: { title: fixture.title, processName: 'test', windowId: 'test' } }
fs.writeFileSync(html, `<html lang="zh"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/${stem}.tsx"></script></body></html>`)
fs.writeFileSync(entry, `
import './src/styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from './src/i18n'
import { ThemeProvider } from './src/themes/context'
import { RootTooltipProvider } from './src/components/ui/tooltip'
import { CLINVEXADesktop } from './src/clinvexa/clinvexa-desktop'
import { CopilotPanel } from './src/clinvexa/copilot/panel'
import { $consultation } from './src/clinvexa/consultation/live-session'
const state = ${JSON.stringify(state)}
window.__consultation = $consultation
let platformConnected = false
let platformRuns = []
const firstCatalog = new Promise(resolve => {window.__releaseAgents = resolve})
const platformAgents = [{id:'11111111-1111-1111-1111-111111111111',name:'问诊资料整理助手',version:'1.0.0',description:'整理提供的问诊资料，生成供医生核对的文书草稿。',kind:'agent',local_compatible:true,unavailable_reason:''},{id:'unsupported',name:'院内知识检索助手',version:'1.0.0',description:'使用院内知识库检索。',kind:'agent',local_compatible:false,unavailable_reason:'此版本需要尚未接入的知识库步骤'}]

window.hermesDesktop = {
  api: async request => {
    if(request.path.endsWith('/connect')) {platformConnected = request.method !== 'DELETE'; return {connected:platformConnected,url:'https://platform.example',display_name:'合成测试医生'}}
    if(request.path.endsWith('/status')) return {connected:platformConnected,url:'https://platform.example',display_name:'合成测试医生'}
    if(request.path.endsWith('/agents')) {await firstCatalog; if(window.__failAgents) throw new Error('合成同步失败'); return {items:platformAgents}}
    if(request.path.endsWith('/runs') && request.method==='POST') { const row={id:request.body.request_id,input:request.body.text,name:'问诊资料整理助手',version:'1.0.0',status:'completed',phase:'已完成，请核对结果',created_at:Date.now(),output:'主诉：咳嗽三天。过敏史尚需核对。以下内容为合成测试结果。'};platformRuns=[row];return row }
    if(request.path.endsWith('/runs')) return {items:platformRuns}
    throw new Error('Unexpected preview API path')
  },
  requestMicrophoneAccess: async () => true,
  writeClipboard: async () => true,
  CLINVEXAScreen: { getState: async () => ({ context: null, error: null, status: 'paused' }), onState: () => () => {} },
  CLINVEXAWindow: { onOpenSidebar: cb => { window.__openWorkspace = cb; return () => {} }, publishConsultation: view => { window.__view = view }, onConsultationCommand: () => () => {}, openSidebar: page => window.__openWorkspace?.(page), },
  CLINVEXACopilot: { getState: async () => state, onState: () => () => {}, history: async () => [state.result], taskHistory: async () => [state.result], versions: async () => [], setExpanded: async () => {}, setEnabled: async () => {}, analyze: async () => {}, knowledge: async () => [], saveDraft: async (id, revision, draft) => ({...state.result, revision: revision + 1, draft}), copy: async () => ({status:'copied',message:'已复制，可粘贴至当前输入框',fields:[]}) }
}
createRoot(document.getElementById('root')!).render(<I18nProvider initialLocale="zh" configClient={null}><ThemeProvider><RootTooltipProvider>{location.search.includes('ball') ? <CopilotPanel /> : <CLINVEXADesktop onSubmit={async () => true} />}</RootTooltipProvider></ThemeProvider></I18nProvider>)
`)
let server, browser, page
const errors = []
let record = null
let packets = 0
const draft = '主诉：咳嗽3天。\n现病史：患者自述咳嗽三天，过敏史待核对。'
const skill = { name: 'record-structuring', title: '病历结构化', description: '从提供的病历资料整理结构化草稿，保留来源并供医生核对。', scope: 'platform', dependencies: [], default_version: '1.0.0', versions: ['1.0.0'], version: '1.0.0', installed: true, enabled: true }
try {
  const bundle = path.join(output, 'bundle')
  await build({ root: desktop, configFile: path.join(desktop, 'vite.config.ts'), logLevel: 'warn', build: { outDir: bundle, emptyOutDir: false, rolldownOptions: { input: html } } })
  server = http.createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '')
    const file = path.resolve(bundle, requested)
    if (!file.startsWith(`${bundle}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {response.writeHead(404); response.end(); return}
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  console.log('Preview server ready')
  const base = `http://127.0.0.1:${server.address().port}/${stem}.html`
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], timeout: 90000 })
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })
  await context.route('http://127.0.0.1:8001/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    let body
    if (request.method() === 'OPTIONS') {await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' } }); return}
    if (url.pathname.endsWith('/skills')) body = [skill]
    else if (url.pathname.endsWith('/consultations') && request.method() === 'GET') body = []
    else if (url.pathname.endsWith('/consultations')) {
      const input = request.postDataJSON()
      record = { id: 'b'.repeat(32), patient_id: input.patient_id, patient_name: input.patient_name, consent_confirmed: true, status: 'recording', started_at: new Date().toISOString(), ended_at: null, duration_ms: 0, draft: null, draft_text: '', transcript: '', raw_transcript: '', segments: [], markers: [], marker_titles: [], draft_fields: [], analysis_mode: 'deterministic_fallback', doctor_draft_revision: 0 }
      body = record
    } else if (url.pathname.includes('/segments/')) {
      const bytes = request.postDataBuffer()
      if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.readUInt16LE(22) !== 1) throw new Error('Audio is not independently decodable mono WAV')
      packets++
      record = { ...record, transcript: '说话人待确认：咳嗽三天。', raw_transcript: '咳嗽三天。', draft_text: record.doctor_draft ?? draft, draft: { quality_issues: ['过敏史待核对。'] }, segments: [...record.segments, { sequence: packets - 1, text: '咳嗽三天。', duration_ms: 4000 }] }
      body = record
    } else if (url.pathname.endsWith('/complete')) {
      if (Number(url.searchParams.get('segment_count')) !== packets) throw new Error('Finalization missed audio packets')
      record = { ...record, status: 'ready' }; body = record
    } else if (url.pathname.endsWith('/draft')) {
      const input = request.postDataJSON()
      record = { ...record, doctor_draft: input.draft, doctor_draft_revision: input.revision + 1, draft_text: input.draft }; body = record
    } else {body = record || {}}
    await route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {if (message.type() === 'error') errors.push(message.text())})
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  page.on('response', response => {if (response.url().includes(stem)) console.log(`Preview HTTP ${response.status()}: ${response.url()}`)})
  await page.goto(base, { timeout: 120000, waitUntil: 'commit' })
  await page.waitForFunction(() => window.__openWorkspace, null, { timeout: 240000 })
  console.log('CLINVEXA mounted')
  await page.evaluate(() => window.__openWorkspace('copilot'))
  await expect(page.getByLabel('任务与进度').getByText('当前正在补充门诊病历', { exact: false })).toBeVisible({ timeout: 20000 })
  await page.screenshot({ path: path.join(output, 'workspace.png') })
  await page.getByRole('button', { name: '技能广场', exact: true }).click()
  await expect(page.getByRole('heading', { name: '病历结构化' })).toBeVisible()
  await page.screenshot({ path: path.join(output, 'skills.png') })
  await page.getByRole('button', {name:'平台账号登录',exact:true}).click()
  await expect(page.getByRole('button', {name:'使用平台账号登录',exact:true})).toBeVisible()
  await page.screenshot({path:path.join(output,'platform-connect.png')})
  await page.getByLabel('平台账户',{exact:true}).fill('synthetic@example.com')
  await page.getByLabel('密码',{exact:true}).fill('synthetic-only-password')
  await page.getByRole('button',{name:'使用平台账号登录',exact:true}).click()
  await expect(page.getByText('正在同步已安装能力…')).toBeVisible()
  await expect(page.getByText('尚无可见的已安装能力。请先在平台安装智能体或 Skill，再同步。')).toHaveCount(0)
  await page.screenshot({path:path.join(output,'platform-loading.png')})
  await page.evaluate(() => window.__releaseAgents())
  await expect(page.getByRole('button',{name:/^问诊资料整理助手/})).toBeVisible()
  await page.getByPlaceholder('搜索已安装智能体').fill('没有这个智能体')
  await expect(page.getByText('没有匹配的智能体')).toBeVisible()
  await page.screenshot({path:path.join(output,'platform-search-empty.png')})
  await page.getByRole('button',{name:'清除搜索',exact:true}).filter({hasText:'清除搜索'}).click()
  await page.evaluate(() => {window.__failAgents = true})
  await page.getByRole('button',{name:'同步已安装能力',exact:true}).click()
  await expect(page.getByText('同步未完成，已保留上次列表。请点击“同步已安装能力”重试。')).toBeVisible()
  await expect(page.getByRole('button',{name:/^问诊资料整理助手/})).toBeVisible()
  await page.screenshot({path:path.join(output,'platform-sync-error.png')})
  await page.evaluate(() => {window.__failAgents = false})
  await page.getByRole('button',{name:'同步已安装能力',exact:true}).click()
  await expect(page.getByText('同步未完成，已保留上次列表。请点击“同步已安装能力”重试。')).toHaveCount(0)
  await page.getByRole('button',{name:/^问诊资料整理助手/}).click()
  await page.getByLabel('安排工作',{exact:true}).fill('合成测试患者咳嗽三天，请整理问诊草稿。')
  await page.getByRole('button',{name:'开始工作',exact:true}).click()
  await expect(page.getByLabel('智能体运行结果').getByText('已完成，请核对结果')).toBeVisible()
  await page.screenshot({path:path.join(output,'platform-result.png')})
  await page.getByRole('button', { name: '问诊记录', exact: true }).click()
  await page.getByLabel('患者编号', { exact: true }).fill('SYNTH-01')
  await page.getByLabel('患者姓名（可选）').fill('合成测试患者')
  await page.getByLabel('患者已知情并同意本次问诊记录。').check()
  await page.getByRole('button', { name: '开始问诊记录', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('咳嗽三天', { timeout: 20000 })
  await page.getByRole('button', { name: '技能广场', exact: true }).click()
  await expect.poll(() => packets, { timeout: 12000 }).toBeGreaterThan(1)
  await page.getByRole('button', { name: /^问诊记录/ }).click()
  await page.getByLabel('病历草稿', { exact: true }).fill('医生已修改并核对的草稿。')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect.poll(() => record.doctor_draft).toBe('医生已修改并核对的草稿。')
  await page.screenshot({ path: path.join(output, 'consultation-live.png') })
  await page.getByRole('button', { name: '结束并核对草稿', exact: true }).click()
  await expect.poll(() => record.status).toBe('ready')
  await expect(page.getByLabel('病历草稿', { exact: true })).toHaveValue('医生已修改并核对的草稿。')
  await page.screenshot({ path: path.join(output, 'consultation-ready.png') })
  const ball = await context.newPage()
  ball.on('pageerror', error => errors.push(String(error)))
  await ball.setViewportSize({ width: 460, height: 740 })
  await ball.goto(`${base}?ball`, { timeout: 120000, waitUntil: 'commit' })
  await expect(ball.getByRole('button', { name: '当前建议', exact: true })).toBeVisible({ timeout: 120000 })
  await ball.screenshot({ path: path.join(output, 'floating-screen.png') })
  const view = await page.evaluate(() => window.__view)
  await ball.evaluate(view => window.__consultation.set(view), view)
  await ball.getByRole('button', { name: '问诊记录', exact: true }).click()
  await ball.screenshot({ path: path.join(output, 'floating-consultation.png') })
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: errors.length === 0, synthetic: true, packets, errors, verified: ['mono WAV packet capture', 'live results before stop', 'recording continues across navigation', 'doctor edit saved and preserved', 'all packets finalized', 'workspace and floating layouts'] }, null, 2))
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(JSON.stringify({ passed: true, packets, output }))
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.txt'), `${error.stack}\n${errors.join('\n')}`)
  await page?.screenshot({ path: path.join(output, 'failure.png'), timeout: 60000 }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  if (server) {await new Promise(resolve => server.close(resolve))}
  fs.unlinkSync(entry); fs.unlinkSync(html)
}
