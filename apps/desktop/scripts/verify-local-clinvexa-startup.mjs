import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
const evidence=path.resolve(import.meta.dirname,'../../../../.codex-work/installer-20260917')
const executablePath=path.join(process.env.LOCALAPPDATA,'Programs/CLINVEXA/CLINVEXA.exe')
const userData=path.join(process.env.APPDATA,'CLINVEXA')
const log=path.join(userData,'runtime/logs/desktop.log')
const before=fs.existsSync(log)?fs.readFileSync(log,'utf8').length:0
const env={...process.env,HERMES_DESKTOP_SKIP_QUIT_CONFIRM:'1'}
for(const key of ['ELECTRON_RUN_AS_NODE','CLINVEXA_RUNTIME_HOME','HERMES_DESKTOP_USER_DATA_DIR','HERMES_DESKTOP_PYTHON','HERMES_DESKTOP_HERMES_ROOT']) delete env[key]
let app
try{
  app=await electron.launch({executablePath,env,timeout:120000})
  assert.equal(await app.evaluate(({app})=>app.getVersion()),'2.0.1')
  let ready=false
  for(let i=0;i<240;i++){
    const text=fs.existsSync(log)?fs.readFileSync(log,'utf8').slice(before):''
    if(text.includes('CLINVEXA backend is ready')){ready=true;break}
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  assert.ok(ready,'Real user-profile backend did not become ready')
  let main
  for(let i=0;i<60;i++){
    main=app.windows().find(page=>!page.url().includes('win=clinvexa')&&page.url().includes('index.html'))
    if(main && await main.getByText('问诊记录',{exact:true}).count()) break
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  assert.ok(main,'Main application page missing')
  const errors=[]
  main.on('pageerror',error=>errors.push(error.message))
  await main.getByText('问诊记录',{exact:true}).first().click()
  await main.locator('.dc-consultation').waitFor({timeout:30000})
  await main.screenshot({path:path.join(evidence,'v201-local-consultation.png')})
  await main.getByText('医疗智能体',{exact:true}).first().click()
  await main.locator('.dc-capability-catalog').waitFor({timeout:30000})
  await main.screenshot({path:path.join(evidence,'v201-local-agents.png')})
  await main.getByText('视觉副驾驶',{exact:true}).first().click()
  await main.waitForTimeout(1000)
  await main.screenshot({path:path.join(evidence,'v201-local-main.png')})
  assert.deepEqual(errors,[],'Application page raised runtime exceptions during navigation')
  // The medical worker boots independently after the main chat backend.
  // Exercise its ready endpoint rather than racing its Python startup.
  let skills
  for(let attempt=0;attempt<120;attempt++){
    try{const health=await fetch('http://127.0.0.1:8001/clinvexa/skills',{signal:AbortSignal.timeout(3000)});if(health.ok){skills=await health.json();break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000))
  }
  assert.ok(Array.isArray(skills)&&skills.length>=27)
  const result={passed:true,version:'2.0.1',executablePath,userData,backendReady:true,consultationPage:true,medicalAgentsPage:true,visualCopilotNavigation:true,skillCount:skills.length,pageErrors:errors}
  fs.writeFileSync(path.join(evidence,'v201-local-startup-verification.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
}finally{if(app)await app.close()}
