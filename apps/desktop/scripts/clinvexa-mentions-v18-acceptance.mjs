import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { _electron, expect } from '@playwright/test'
const desktop = path.resolve(import.meta.dirname, '..'), repo = path.resolve(desktop, '../..')
const out = process.env.CLINVEXA_ACCEPTANCE_OUTPUT || path.resolve(repo, '../.codex-work/mentions-v18-20260916')
fs.mkdirSync(out,{recursive:true})
const home = process.env.CLINVEXA_ACCEPTANCE_RUNTIME_HOME || path.join(out,'native-home');fs.mkdirSync(home,{recursive:true})
const runtimePython = process.env.CLINVEXA_ACCEPTANCE_RUNTIME_HOME ? path.join(home,'hermes-agent/venv/Scripts/python.exe') : path.join(repo,'.venv/Scripts/python.exe')
const archive=fs.readFileSync(path.resolve(repo, '../.codex-work/summon-20260915/agent.zip')), sha=crypto.createHash('sha256').update(archive).digest('hex')
const id='11111111-1111-1111-1111-111111111111', title='科室会议纪要与待办助手'
let port, grantCount=0, modelSawRecipe=false, modelSawTask=false, localSawRecipe=false, sawHistory=false, app, page
const executable=process.env.CLINVEXA_SUMMON_EXE
const evidence={synthetic:true,fixtures:'Synthetic platform and chat responses; validates authorization/mention/recipe plumbing, not cloud model quality',packaged:Boolean(executable),python:runtimePython,checks:[],passed:false}
const server=http.createServer(async (req,res)=>{
 const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
 if(req.url==='/package.zip'){res.writeHead(200);res.end(archive);return}
 if(req.url.startsWith('/api/')){
  if(req.url.endsWith('/auth/login'))return json({id:'owner'})
  if(req.url.endsWith('/capabilities'))return json({protocol:'clinvexa-local-v1'})
  if(req.url.endsWith('/me'))return json({id:'owner',display_name:'合成测试医生'})
  if(req.url.includes('/grant')){grantCount++;return json({protocol:'clinvexa-local-v1',execution:'clinvexa',name:title,version:'1.0',sha256:sha,download_url:`http://127.0.0.1:${port}/package.zip`})}
  if(req.url.includes('/desktop/agents'))return json({items:[{id,name:title,version:'1.0',description:'整理科室会议决定、负责人和待办事项。',local_compatible:true,installed_at:'2026-09-16T10:00:00Z'},...Array.from({length:5},(_,i)=>({id:'extra-'+i,name:'测试智能体'+i,description:'合成测试',local_compatible:true,installed_at:'2026-09-10T00:00:00Z'}))],total:1})
  return json({})
 }
 if(req.url.includes('/models'))return json({data:[{id:'synthetic-chat',object:'model'}]})
 let body='';for await(const c of req)body+=c
 const task=JSON.parse(body||'{}');const serialized=JSON.stringify(task.messages||[])
 modelSawRecipe ||= serialized.includes('列出决定、负责人、截止时间')
 modelSawTask ||= serialized.includes('周五前整理培训材料')
 localSawRecipe ||= serialized.includes('clinvexa.deterministic_skills')
 sawHistory ||= serialized.includes('SYN-HISTORY-17') && serialized.includes('周五前整理培训材料')
 const answer=serialized.includes('SYN-LOCAL-17')?'本机技能调用完成 SYN-LOCAL-PASS':serialized.includes('周五前整理培训材料')?'已整理会议待办：王医生负责在周五前整理培训材料。验收标记 SYN-SUMMON-PASS。':'已收到。'
 if(task.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const text of [answer.slice(0,12),answer.slice(12)]) {res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',model:'synthetic-chat',choices:[{index:0,delta:{content:text},finish_reason:null}]})+'\n\n');await new Promise(r=>setTimeout(r,120))}res.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n')}
 else json({id:'test',choices:[{message:{role:'assistant',content:answer},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10}})
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port
fs.writeFileSync(path.join(home,'config.yaml'),JSON.stringify({model:{provider:'custom',default:'synthetic-chat',base_url:`http://127.0.0.1:${port}/v1`,api_key:'synthetic-only'},display:{language:'zh'},stt:{enabled:false}}))
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS)$/.test(k)))
for(const key of ['ELECTRON_RUN_AS_NODE','HERMES_DESKTOP_IS_PACKAGED','HERMES_DESKTOP_DEV_SERVER'])delete env[key]
try{
 app=await _electron.launch({executablePath:executable||path.join(repo,'node_modules/electron/dist/electron.exe'),args:[...(executable?[]:[desktop]),'--disable-gpu'],cwd:desktop,env:{...env,HERMES_HOME:home,CLINVEXA_RUNTIME_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(out,'native-data'),HERMES_DESKTOP_HERMES_ROOT:executable?path.join(path.dirname(executable),'resources/clinvexa-runtime'):repo,HERMES_DESKTOP_PYTHON:runtimePython,HERMES_DESKTOP:'1',CLINVEXA_DESKTOP:'1',HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_APP_NAME:'CLINVEXAMentionV18Test',HERMES_DESKTOP_SKIP_QUIT_CONFIRM:'1'},timeout:120000})
 app.process().stderr?.on('data',chunk=>fs.appendFileSync(path.join(out,'app.log'),chunk))
 await expect.poll(()=>app.windows().some(p=>p.url().includes('index.html')&&!p.url().includes('win=')),{timeout:120000}).toBe(true)
 page=app.windows().find(p=>p.url().includes('index.html')&&!p.url().includes('win='))
 await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows()){if(!w.webContents.getURL().includes('win=')){w.setSize(1440,960);w.webContents.setZoomFactor(1)}}})
 const nav=page.locator('[data-sidebar="menu"]').filter({has:page.getByRole('button',{name:'定时任务',exact:true})})
 const medical=nav.getByRole('button',{name:'医疗智能体',exact:true})
 await expect(medical).toBeVisible({timeout:180000});await medical.focus();await medical.press('Enter')
 await expect(page.getByRole('main',{name:'CLINVEXA 医疗智能体'})).toBeVisible()
 await page.getByText('绑定平台账号',{exact:true}).click()
 await page.getByLabel('平台地址',{exact:true}).fill(`http://127.0.0.1:${port}`)
 await page.getByLabel('平台账户',{exact:true}).fill('test@example.invalid')
 await page.getByLabel('密码',{exact:true}).fill('synthetic-only')
 await page.getByRole('button',{name:'使用平台账号登录',exact:true}).click()
 await expect(page.getByRole('button',{name:`召唤 ${title}`,exact:true})).toBeEnabled({timeout:30000})
 await page.getByRole('heading',{name:'医疗智能体',exact:true}).scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(out,'catalog.png')})
 await page.getByRole('main',{name:'CLINVEXA 医疗智能体'}).getByRole('button',{name:'关闭',exact:true}).click()
 const input=page.locator('[contenteditable="true"]').first()
 await expect(input).toBeVisible({timeout:60000})
 await input.fill('请记住会议编号 SYN-HISTORY-17。');await input.press('Enter')
 await expect(page.getByText('已收到。',{exact:true}).first()).toBeVisible({timeout:120000})
 const conversation=page.url()
 const drawer=page.locator('[data-slot="composer-completion-drawer"]')
 await input.fill('@');await input.press('End')
 await expect(drawer.getByRole('button').filter({hasText:/^@/})).toHaveCount(8,{timeout:30000})
 const menuText=await drawer.innerText()
 if(menuText.indexOf('智能体')>menuText.indexOf('技能'))throw new Error('Wrong group order')
 await expect(drawer.getByRole('button').filter({hasText:/^@/}).first()).toContainText(title)
 await page.screenshot({path:path.join(out,'collapsed-menu.png')})
 await drawer.getByRole('button',{name:'显示更多智能体 · 还有 2 个智能体',exact:true}).click()
 await expect(drawer.getByRole('button').filter({hasText:/^@/})).toHaveCount(10)
 await drawer.getByRole('button',{name:'收起智能体',exact:true}).click()
 await expect(drawer.getByRole('button').filter({hasText:/^@/})).toHaveCount(8)
 await drawer.getByRole('button').filter({hasText:'显示更多技能'}).click()
 await expect.poll(async()=>drawer.getByRole('button').filter({hasText:/^@/}).count()).toBeGreaterThan(8)
 await drawer.getByRole('button',{name:'收起技能',exact:true}).click()
 evidence.checks.push('agents-first-four-each-newest-first-expand-collapse')
 await input.fill('@会议');await input.press('ArrowLeft');await input.press('End')
 await expect(drawer.getByRole('button').filter({hasText:`@${title}`})).toBeVisible({timeout:30000})
 await page.screenshot({path:path.join(out,'mention-menu.png')})
 await drawer.getByRole('button').filter({hasText:`@${title}`}).click()
 await expect(page.locator('[data-slot="summoned-assistant"]')).toContainText(title)
 await expect(input).toBeEmpty()
 evidence.checks.push('agent-selected-immediately-summoned-before-send')
 await input.press('End');await input.press('Space');await page.keyboard.insertText('请整理会议：王医生周五前整理培训材料。');await input.press('Enter')
 await expect(page.getByText(/SYN-SUMMON-PASS/).first()).toBeVisible({timeout:120000})
 await expect(page.locator('[data-slot="summoned-assistant"]')).toContainText(title)
 if(page.url()!==conversation)throw new Error('Mention navigated away from the current conversation')
 if(!modelSawRecipe||!modelSawTask||!sawHistory||grantCount<1)throw new Error('Missing authorized recipe, task, or previous context')
 evidence.checks.push('platform-mention-picked-in-existing-chat','real-grant-hash-prepare-model-stream','previous-conversation-preserved')
 await page.getByRole('button',{name:`移除 ${title}`,exact:true}).click()
 await input.fill('@record-structuring');await input.press('ArrowLeft');await input.press('End')
 await expect(drawer.getByRole('button').filter({hasText:'@病历结构化'})).toBeVisible({timeout:30000})
 await input.press('Enter');await expect(page.locator('[data-slot="summoned-assistant"]')).toContainText('病历结构化');await expect(input).toBeEmpty();evidence.checks.push('skill-selected-immediately-summoned-no-file-chip')
 await input.press('End');await input.press('Space');await page.keyboard.insertText('整理测试资料 SYN-LOCAL-17');await input.press('Enter')
 await expect(page.getByText(/SYN-LOCAL-PASS/).first()).toBeVisible({timeout:120000})
 if(!localSawRecipe)throw new Error('Local deterministic skill instructions did not reach the model')
 if(page.url()!==conversation)throw new Error('Local mention changed conversation')
 await expect(page.locator('[data-slot="summoned-assistant"]')).toContainText('病历结构化')
 evidence.checks.push('local-skill-search-by-id-and-keyboard-select','real-local-prepare-reaches-main-chat','helper-chip-in-same-conversation')
 await page.screenshot({path:path.join(out,'main-result.png')})
 for (const name of ['视觉副驾驶','问诊记录','医疗智能体','任务进度','桌面操作']) {
  const entry=nav.getByRole('button',{name,exact:true})
  await entry.focus(); await entry.press('Enter')
  await expect(entry).toHaveAttribute('aria-current','page')
  await expect(page.locator('.dc-main-page-host > .dc-main-page')).toBeVisible()
  evidence.checks.push('main-workspace-navigation:'+name)
 }
 evidence.passed=true
}catch(error){evidence.error=String(error);if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''))}process.exitCode=1}
finally{fs.writeFileSync(path.join(out,'native-result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await app?.close();server.close()}
