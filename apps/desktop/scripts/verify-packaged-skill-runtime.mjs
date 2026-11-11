import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'

const root=process.env.CLINVEXA_RELEASE_DIR
assert.ok(root,'Explicit release directory required')
const payload=JSON.parse(fs.readFileSync(path.join(root,'installer-verification.json'),'utf8'))
assert.ok(payload.passed,'Real installer extraction and payload checks must pass first')
const home=process.env.CLINVEXA_SKILL_VERIFY_HOME || path.join(root,'clean-runtime')
const expectedStages=['uv','python','git','node','system-packages','repository','venv','dependencies','node-deps','path','config-templates','platform-sdks','bootstrap-marker']
const resumeSkills=process.env.CLINVEXA_RESUME_SKILL_CHECK==='1'
let previous
if(resumeSkills) {
 previous=JSON.parse(fs.readFileSync(path.join(root,'skill-runtime-verification.json'),'utf8'))
 assert.equal(previous.passed,false)
 assert.equal(previous.home,home)
 assert.deepEqual(previous.stages,expectedStages,'Resume only after every fresh bootstrap stage has passed')
 assert.match(previous.error,/packaged-skills failed/)
} else assert.ok(!fs.existsSync(home),'Fresh runtime is required; do not reuse developer dependencies')
fs.mkdirSync(home,{recursive:true})
const source=path.join(home,'hermes-agent')
const resources=path.join(payload.target,'resources')
const stamp=JSON.parse(fs.readFileSync(path.join(resources,'install-stamp.json'),'utf8'))
const setup=path.join(resources,'clinvexa-runtime/scripts/install.ps1')
const env={...process.env,CLINVEXA_PRODUCT_IDENTITY:'1',HERMES_HOME:home,
 CLINVEXA_BUNDLED_DEPS_ARCHIVE:path.join(resources,'clinvexa-dependencies/windows-x64.tar.gz'),
 UV_OFFLINE:'1',UV_PYTHON_DOWNLOADS:'never',PIP_NO_INDEX:'1',HF_HUB_OFFLINE:'1',
 HTTP_PROXY:'http://127.0.0.1:9',HTTPS_PROXY:'http://127.0.0.1:9',NO_PROXY:'localhost,127.0.0.1',
 PYTHONIOENCODING:'utf-8'}
for(const key of Object.keys(env)) if(/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)||['PYTHONPATH','VIRTUAL_ENV','UV_PYTHON','UV_PROJECT_ENVIRONMENT','HERMES_DESKTOP_PYTHON','HERMES_DESKTOP_HERMES_ROOT','HERMES_GIT_BASH_PATH'].includes(key)) delete env[key]
env.PATH=[path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot,path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0')].join(path.delimiter)
// Node launched from pwsh inherits PowerShell 7's modules. Windows PowerShell
// cannot load those; use its OS-provided modules, as a normal Explorer launch does.
env.PSModulePath=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')
env.UV_CACHE_DIR=path.join(home,'uv-cache')
env.UV_PYTHON_INSTALL_DIR=path.join(home,'python')
const stages=resumeSkills?[...previous.stages]:[]
async function run(program,args,label) {
 const log=fs.openSync(path.join(root,label+'.log'),'w')
 try {
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(program,args,{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]})
   child.on('error',reject);child.on('exit',resolve)
  })
  assert.equal(code,0,label+' failed; inspect its log')
 } finally {fs.closeSync(log)}
 console.log('PASS '+label)
}
try {
 for(const stage of resumeSkills?[]:expectedStages) {
  await run(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',setup,'-Stage',stage,'-NonInteractive','-Json','-HermesHome',home,'-InstallDir',source,'-Commit',stamp.commit],'fresh-'+stage)
  stages.push(stage)
 }
 const python=path.join(source,'venv/Scripts/python.exe')
 const test=path.join(root,'packaged-skills-check.py')
 fs.copyFileSync(path.resolve(import.meta.dirname,'../../../scripts/clinvexa_packaged_skills_check.py'),test)
 await run(python,['-I',test,'--home',home,'--output',path.join(root,'packaged-skills.json')],'packaged-skills')
 const skills=JSON.parse(fs.readFileSync(path.join(root,'packaged-skills.json'),'utf8'))
 assert.ok(skills.passed && skills.ownedPython && skills.executions.length===6 && skills.batchRows===3)
 const installerHash=crypto.createHash('sha256')
 for await(const chunk of fs.createReadStream(payload.installer)) installerHash.update(chunk)
 const result={passed:true,installer:payload.installer,installerSha256:installerHash.digest('hex'),home,stages,offline:true,developerPythonUsed:false,skills}
 fs.writeFileSync(path.join(root,'skill-runtime-verification.json'),JSON.stringify(result,null,2))
 fs.writeFileSync(path.join(root,'release-readiness.json'),JSON.stringify({passed:true,scope:'Packaged fresh offline bootstrap and Skill execution; no claim of all-feature clinical accuracy',sourceManifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'installer-manifest.json'))).digest('hex')},null,2))
 console.log(JSON.stringify({passed:true,home,catalogSkills:skills.catalogSkills,executions:skills.executions.length}))
} catch(error) {
 fs.writeFileSync(path.join(root,'skill-runtime-verification.json'),JSON.stringify({passed:false,home,stages,error:String(error)},null,2))
 throw error
}
