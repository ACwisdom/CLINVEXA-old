import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
const root='C:/Users/home/AppData/Local/Temp/clinvexa-release-20260921'
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))
const meta=read('release-metadata.json')
const verification=read('installer-verification.json')
assert.ok(verification.passed && verification.installer===meta.offline.file)
assert.ok(read('stage-result.json').originalResourcesPreserved)
const key=path.join(process.env.USERPROFILE,'.ssh/id_rsa_deploy')
const host='ubuntu@43.138.188.149'
const options=['-i',key,'-o','BatchMode=yes','-o','ConnectTimeout=15']
const remote='/home/ubuntu/clinvexa-release-20260921'
const relative=`/install-apps/clinvexa/releases/20260921/${meta.offline.sha256}`
const dest=`/opt/medical-ai-platform/install APPS/clinvexa/releases/20260921/${meta.offline.sha256}`
const manifest={version:'2.0.5',publishedAt:'2026-09-21'}
async function run(program,args){await new Promise((resolve,reject)=>{const p=spawn(program,args,{windowsHide:true,stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(program+' exited '+code)))})}
async function uploaded(name,hash){return await new Promise((resolve,reject)=>{const p=spawn('ssh',[...options,host,`test -f '${remote}/${name}' && test "$(sha256sum '${remote}/${name}' | cut -d ' ' -f1)" = '${hash}'`],{windowsHide:true,stdio:'ignore'});p.on('error',reject);p.on('exit',code=>resolve(code===0))})}
await run('ssh',[...options,host,`mkdir -p '${remote}'`])
for(const [kind,name] of [['offline','CLINVEXA-Offline-Setup.exe'],['online','CLINVEXA-Online-Setup.exe']]){
  assert.match(meta[kind].sha256,/^[a-f0-9]{64}$/)
  console.log('Uploading '+kind+' '+meta[kind].bytes+' bytes')
  if(!await uploaded(name,meta[kind].sha256)) await run('scp',['-q',...options,meta[kind].file,`${host}:${remote}/${name}`])
  await run('ssh',[...options,host,`set -eu\ntest "$(sha256sum '${remote}/${name}' | cut -d ' ' -f1)" = '${meta[kind].sha256}'\nsudo -n mkdir -p '${dest}'\nsudo -n install -m 644 '${remote}/${name}' '${dest}/${name}'\ntest "$(sha256sum '${dest}/${name}' | cut -d ' ' -f1)" = '${meta[kind].sha256}'`])
  manifest[kind]={url:`${relative}/${name}`,bytes:meta[kind].bytes,sha256:meta[kind].sha256}
}
fs.writeFileSync(path.join(root,'latest.json'),JSON.stringify(manifest,null,2))
// The caller publishes latest.json only after exercising real HTTPS downloads.
fs.writeFileSync(path.join(root,'upload-receipt.json'),JSON.stringify({verified:true,manifest,destination:dest},null,2))
console.log('Both installers uploaded and SHA-256 verified; index not switched yet.')
