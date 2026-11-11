/** Real Electron / Windows / gateway acceptance using synthetic patient data.
 * Provider is a local fixture, explicitly NOT a model quality/performance test.
 * Run after build: node scripts/clinvexa-copilot-acceptance.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { _electron, chromium, expect } from '@playwright/test'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const output = process.env.CLINVEXA_ACCEPTANCE_OUTPUT || path.resolve(repo, '../.codex-work/copilot-v12-acceptance')
const packaged = process.env.CLINVEXA_ACCEPTANCE_PACKAGED
const runtimeRoot = packaged ? path.join(path.dirname(packaged),'resources/clinvexa-runtime') : repo
const repeatCount = Number(process.env.CLINVEXA_ACCEPTANCE_REPEATS ?? 30)
fs.mkdirSync(output, { recursive: true })
const sandbox = fs.mkdtempSync(path.join(output, 'run-'))
const hermesHome = path.join(sandbox, 'home')
const userData = path.join(sandbox, 'desktop')
fs.mkdirSync(hermesHome); fs.mkdirSync(userData)
const labels = ['主诉', '现病史', '既往史', '体格检查', '辅助检查']
const texts = ['随访复查。', '本次为合成数据测试，无真实患者。', '未提供，待核对。', '体温 36.5 ℃，血压 128/76 mmHg。', '未提供本次检查报告。']
const fixture = {
  patientId:'SYNTH-A',patientName:'测试小王（合成）',encounterId:'SYNTH-E1',scene:'record',
  summary:'已识别病历中的 5 个内容栏，可按所选字段快捷填写。', facts:texts,missing:['过敏史未提供，待核对。'],
  suggestions:labels.map((title,i)=>({ id:`s${i}`,kind:'field',title,text:texts[i],reason:'按当前画面和合成病例资料整理。',evidence:[texts[i]],sourceIds:[],cautions:[],targetLabel:title }))
}
const requests = []
const server = http.createServer((req,res)=>{
  if(req.url === '/v1/models') {res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({data:[{id:'copilot-fixture',object:'model'}]})); return}
  let body=''; req.on('data',chunk=>body+=chunk)
  req.on('end',()=>{
    const parsed=JSON.parse(body || '{}')
    if (!Array.isArray(parsed.messages)) {res.statusCode=404; res.end('{}'); return}
    requests.push({at:Date.now(),images:JSON.stringify(parsed.messages).includes('image_url'),tools:Boolean(parsed.tools?.length)})
    res.setHeader('Content-Type','application/json')
    res.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'copilot-fixture',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(fixture)}}]}))
  })
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const baseUrl=`http://127.0.0.1:${server.address().port}/v1`
fs.writeFileSync(path.join(hermesHome,'config.yaml'), JSON.stringify({ model:{provider:'custom',default:'copilot-fixture',base_url:baseUrl,api_key:'local-test'},auxiliary:{vision:{provider:'custom',model:'copilot-fixture',base_url:baseUrl,api_key:'local-test'}},display:{language:'zh'},agent:{max_turns:3},stt:{enabled:false} }))
fs.writeFileSync(path.join(userData,'window-state.json'),JSON.stringify({x:0,y:0,width:1400,height:900,isMaximized:false}))
fs.writeFileSync(path.join(userData,'zoom-state.json'),JSON.stringify({zoomLevel:0}))
const clean = Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value && !/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(key)))
delete clean.ELECTRON_RUN_AS_NODE
const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>CLINVEXA 合成验收 HIS</title><style>body{font:18px 'Microsoft YaHei',sans-serif;margin:0;background:#f3f6fa;color:#173151}header{background:#173151;color:white;padding:20px 35px}main{max-width:900px;margin:25px auto}h2{font-size:20px}aside{padding:18px;background:white;margin-bottom:20px}label{display:grid;grid-template-columns:130px 1fr;align-items:start;margin:14px 0}textarea{font:16px 'Microsoft YaHei',sans-serif;min-height:52px;padding:12px;border:1px solid #cad5e5;border-radius:6px}button{padding:10px 24px}</style></head><body><header>合成 HIS · 仅用于软件验收</header><main><h2>测试小王（合成） · 患者 SYNTH-A · 就诊 SYNTH-E1</h2><aside id="case">${texts.join('<br>')}</aside><section>${labels.map((label,i)=>`<label for="f${i}">${label}<textarea id="f${i}" aria-label="${label}"></textarea></label>`).join('')}</section><button id="submit">提交（测试按钮）</button><output id="submitted"></output></main><script>document.querySelector('#submit').onclick=()=>document.querySelector('#submitted').textContent='SUBMITTED';</script></body></html>`
const htmlPath=path.join(sandbox,'synthetic-his.html');fs.writeFileSync(htmlPath,html)
let app, browser
const evidence={sandbox,provider:'local fixture — not a model benchmark',steps:[],requests}
const step=(name,data={})=>{ evidence.steps.push({name,...data}); console.log(JSON.stringify({name,...data})) }
try {
  app=await _electron.launch({executablePath:packaged || path.join(repo,'node_modules/electron/dist/electron.exe'),args:packaged?['--no-sandbox']:[desktop,'--no-sandbox'],cwd:desktop,env:{...clean,HERMES_HOME:hermesHome,CLINVEXA_RUNTIME_HOME:hermesHome,HERMES_DESKTOP_USER_DATA_DIR:userData,HERMES_DESKTOP_HERMES_ROOT:runtimeRoot,HERMES_DESKTOP_PYTHON:path.join(repo,'.venv/Scripts/python.exe'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_APP_NAME:'CLINVEXAAcceptance',CLINVEXA_DESKTOP:'1',HERMES_DESKTOP_SKIP_QUIT_CONFIRM:'1'}})
  app.process().stdout?.on('data',chunk=>fs.appendFileSync(path.join(sandbox,'app.log'),chunk))
  app.process().stderr?.on('data',chunk=>fs.appendFileSync(path.join(sandbox,'app.log'),chunk))
  const ball=await app.waitForEvent('window',{predicate:p=>p.url().includes('win=clinvexa'),timeout:60000}).catch(()=>app.windows().find(p=>p.url().includes('win=clinvexa')))
  if(!ball) throw new Error('floating window missing')
  await ball.waitForLoadState('domcontentloaded')
  await ball.getByRole('button',{name:'打开 CLINVEXA',exact:true}).click()
  await ball.getByRole('button',{name:'收起助手'}).waitFor()
  step('independent-popup',{bounds:await ball.evaluate(()=>({width:innerWidth,height:innerHeight}))})
  await ball.screenshot({path:path.join(output,'popup-empty.png')})
  browser=await chromium.launch({channel:'msedge',headless:false,args:['--force-renderer-accessibility','--window-size=1200,950']})
  const his=await browser.newPage({viewport:{width:1150,height:850}})
  await his.goto(new URL(`file:///${htmlPath.replaceAll('\\','/')}`).href)
  await his.screenshot({path:path.join(output,'synthetic-his.png')})
  // Resolve the real gateway before measuring warm perception; boot is separate.
  await ball.evaluate(()=>window.hermesDesktop.getConnection())
  await his.bringToFront()
  const start=Date.now()
  await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.setEnabled(true))
  await expect.poll(()=>ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>({status:s.status,error:s.error}))),{timeout:45000}).toEqual({status:'ready',error:null})
  const state=await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState())
  step('screen-to-result',{elapsedMs:Date.now()-start,target:state.target,fields:state.result.suggestions.length})
  if(!state.target.title.includes('合成验收 HIS')) throw new Error('wrong target window')
  if(state.result.suggestions.length!==5) throw new Error('five fields missing')
  const noChangeCount=requests.length
  await new Promise(resolve=>setTimeout(resolve,2400))
  if(requests.length!==noChangeCount) throw new Error('unchanged screen caused model requests')
  step('unchanged-frame-deduplicated')
  await ball.bringToFront()
  await ball.screenshot({path:path.join(output,'popup-results.png')})
  for(const label of labels) await ball.getByLabel(`选择 ${label}`,{exact:true}).check()
  const fillStart=Date.now()
  await ball.getByRole('button',{name:'填写所选',exact:true}).click()
  await ball.waitForFunction(()=>document.querySelector('.dc-suggestions [role="status"]')?.textContent,{},{timeout:15000})
  const fillNotice=await ball.locator('.dc-suggestions [role="status"]').textContent()
  const values=await his.locator('textarea').evaluateAll(nodes=>nodes.map(n=>n.value))
  step('five-field-native-fill',{elapsedMs:Date.now()-fillStart,notice:fillNotice,values,matched:values.every((value,i)=>value===texts[i])})
  if(await his.locator('#submitted').textContent()) throw new Error('submit was activated')
  await ball.getByRole('button',{name:'复制所选',exact:true}).click()
  const clipboard=await app.evaluate(({clipboard})=>clipboard.readText())
  if(!texts.every(text=>clipboard.includes(text))) throw new Error('copy omitted selection')
  step('copy-selected-and-no-submit')
  await ball.getByRole('button',{name:'打开工作台'}).click()
  const main=app.windows().find(p=>!p.url().includes('win=clinvexa'))
  await main.getByRole('region',{name:'打开工作台'}).waitFor({timeout:30000})
  await main.getByRole('button',{name:'医生草稿',exact:true}).click()
  await main.getByRole('textbox',{name:'医生草稿',exact:true}).fill('医生手工修改：合成验收草稿。')
  await main.getByRole('button',{name:'保存草稿',exact:true}).click()
  await main.getByText('草稿已保存',{exact:true}).waitFor()
  await main.screenshot({path:path.join(output,'workbench.png')})
  step('three-column-workbench-and-saved-draft')
  const firstId=state.result.id
  await main.getByRole('textbox',{name:'医生草稿',exact:true}).fill('医生第二次修改：仍保留第一版。')
  await main.getByRole('button',{name:'保存草稿',exact:true}).click()
  await expect.poll(()=>ball.evaluate(id=>window.hermesDesktop.CLINVEXACopilot.versions(id).then(rows=>rows.length),firstId)).toBe(2)
  step('saved-draft-version-history')
  const fillRuns=[]
  for(let run=0;run<repeatCount;run++) {
    await his.locator('textarea').evaluateAll(nodes=>nodes.forEach(n=>{n.value='';n.dispatchEvent(new Event('input',{bubbles:true}))}))
    await his.bringToFront()
    // Clearing can restore the last captured empty frame before the filled frame
    // was sampled. Reusing that exact frame is correct; a new result ID is not required.
    await new Promise(resolve=>setTimeout(resolve,2200))
    await expect.poll(()=>ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>s.status==='ready'&&!s.stale)),{timeout:25000}).toBe(true)
    await ball.bringToFront()
    const before=Date.now()
    const filled=await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>window.hermesDesktop.CLINVEXACopilot.fill(s.result.id,s.result.suggestions.map(item=>item.id))))
    const actual=await his.locator('textarea').evaluateAll(nodes=>nodes.map(n=>n.value))
    const passed=filled.status==='filled'&&actual.every((text,i)=>text===texts[i])
    const row={run:run+1,elapsedMs:Date.now()-before,passed,status:filled.status}
    fillRuns.push(row)
    if(!passed) {step('five-field-repeated-failure',{row,filled});throw new Error('repeated fill failed')}
    if((run+1)%5===0) step('five-field-repeated-progress',{completed:run+1})
  }
  step('five-field-repeated',{count:repeatCount,runs:fillRuns})
  const copiedStart=Date.now()
  await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>window.hermesDesktop.CLINVEXACopilot.copy(s.result.id,['s0','s2'])))
  const two=await app.evaluate(({clipboard})=>clipboard.readText())
  if(!two.includes(texts[0])||!two.includes(texts[2])||two.includes(texts[1])) throw new Error('two-item selection mismatch')
  step('copy-two-only',{elapsedMs:Date.now()-copiedStart})
  // Same window and title, now a different patient. Old results must become stale.
  fixture.patientId='SYNTH-B';fixture.encounterId='SYNTH-E2';fixture.patientName='测试小李（合成）'
  await his.locator('h2').evaluate(node=>node.textContent='测试小李（合成） · 患者 SYNTH-B · 就诊 SYNTH-E2')
  await his.bringToFront()
  await expect.poll(()=>ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>s.result?.patientId)),{timeout:25000}).toBe('SYNTH-B')
  const history=await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.history())
  if(!history.find(row=>row.id===firstId)?.draft.includes('第二次修改')) throw new Error('new patient overwrote draft')
  step('same-title-patient-change-and-draft-preserved')
  await his.locator('textarea').evaluateAll(nodes=>nodes.forEach(n=>n.readOnly=true))
  await ball.bringToFront()
  const fallback=await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>window.hermesDesktop.CLINVEXACopilot.fill(s.result.id,['s0'])))
  if(fallback.status!=='failed') throw new Error('read-only input incorrectly reported filled')
  await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>window.hermesDesktop.CLINVEXACopilot.copy(s.result.id,['s0'])))
  step('read-only-falls-back-to-copy',{message:fallback.message})
  await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.setEnabled(false))
  const pausedCount=requests.length
  await his.locator('#case').evaluate(node=>node.textContent='changed while paused')
  await new Promise(resolve=>setTimeout(resolve,2200))
  if(requests.length!==pausedCount) throw new Error('paused still called model')
  if(await his.locator('#submitted').textContent()) throw new Error('submitted unexpectedly')
  step('pause-stops-analysis-and-no-submit')
  // Review regressions and medical-source UI on the actual packaged interface.
  fixture.suggestions[4].text='合成更新报告：用于差异审核测试。'
  await his.locator('textarea').evaluateAll(nodes=>nodes.forEach(n=>n.readOnly=false))
  const priorResult=await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>s.result.id))
  await his.bringToFront()
  await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.setEnabled(true))
  await expect.poll(()=>ball.evaluate(old=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>s.status==='ready'&&s.result.id!==old),priorResult),{timeout:30000}).toBe(true)
  await main.bringToFront()
  await main.locator('.dc-task-list .dc-task').filter({hasText:'测试小李'}).click()
  await main.getByRole('button',{name:'更新对照',exact:true}).click()
  await main.getByLabel('辅助检查',{exact:true}).waitFor()
  await main.screenshot({path:path.join(output,'workbench-compare.png')})
  await main.getByLabel('辅助检查',{exact:true}).check()
  await main.getByRole('button',{name:'采用所选，进入编辑'}).click()
  if(!(await main.getByRole('textbox',{name:'医生草稿',exact:true}).inputValue()).includes('合成更新报告')) throw new Error('selected update missing from editor')
  step('compare-adopt-selected-in-editor')
  await main.getByRole('button',{name:'来源摘录',exact:true}).click()
  await main.locator('.dc-library > summary').click()
  await main.getByLabel('资料标题',{exact:true}).fill('合成依据：仅用于软件验收')
  await main.getByLabel('版本或发布日期',{exact:true}).fill('test-only-v1')
  await main.getByLabel('审核人',{exact:true}).fill('合成测试审核人')
  await main.getByLabel('适用范围与依据原文',{exact:true}).fill('此为软件功能验收合成资料，项目“合成检查 A”不存在，不可用于临床诊疗。')
  await main.getByLabel('我已核对来源、适用范围和版本，同意作为辅助分析依据',{exact:true}).check()
  await main.getByRole('button',{name:'保存依据资料',exact:true}).click()
  await main.getByText('依据已保存，下次分析生效',{exact:true}).waitFor()
  const source=await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.knowledge().then(rows=>rows[0]))
  step('reviewed-source-entry-and-persistence')
  fixture.scene='examination';fixture.summary='软件测试：医生选择合成项目后填写搜索框。'
  fixture.suggestions=[{id:'exam-test',kind:'examination',title:'合成检查 A（测试）',text:'合成检查 A',reason:'仅用于验证选择、填写和来源展示，不是临床建议。',evidence:[texts[0]],sourceIds:[source.id],cautions:['软件测试项目，不可用于临床。'],targetLabel:'检查搜索'}]
  await his.locator('section').evaluate(node=>node.innerHTML='<label for="exam">检查搜索<textarea id="exam" aria-label="检查搜索"></textarea></label>')
  await his.bringToFront()
  await expect.poll(()=>ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.getState().then(s=>s.status==='ready'&&s.result.scene==='examination')),{timeout:30000}).toBe(true)
  await ball.bringToFront()
  await ball.getByLabel('选择 合成检查 A（测试）',{exact:true}).check()
  await ball.screenshot({path:path.join(output,'popup-examination.png')})
  await ball.getByRole('button',{name:'填写所选',exact:true}).click()
  await expect(his.locator('#exam')).toHaveValue('合成检查 A',{timeout:15000})
  if(await his.locator('#submitted').textContent()) throw new Error('exam was submitted')
  step('examination-select-fill-search-only')
  await ball.evaluate(()=>window.hermesDesktop.CLINVEXACopilot.setEnabled(false))
  await ball.screenshot({path:path.join(output,'popup-paused.png')})
  await main.getByRole('button',{name:'医生草稿',exact:true}).click()
  await main.screenshot({path:path.join(output,'workbench-paused.png')})
  if(!values.every((value,i)=>value===texts[i])) throw new Error('Native quick fill did not pass; inspect recorded result')
  evidence.passed=true
} catch(error) {evidence.passed=false;evidence.error=String(error);console.error(String(error));process.exitCode=1}
finally {
  fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify(evidence,null,2))
  fs.writeFileSync(path.join(sandbox,'acceptance.json'),JSON.stringify(evidence,null,2))
  await browser?.close(); await app?.close(); await new Promise(resolve=>server.close(resolve))
}
