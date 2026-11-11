import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'
const evidence=process.env.CLINVEXA_RELEASE_DIR || path.resolve(import.meta.dirname,'../../../../.codex-work/installer-20260917')
const releaseDate=process.env.CLINVEXA_RELEASE_DATE || '20260917'
assert.match(releaseDate,/^\d{8}$/)
const meta=JSON.parse(fs.readFileSync(path.join(evidence,'release-metadata.json'),'utf8'))
const skills=JSON.parse(fs.readFileSync(path.join(evidence,'skill-runtime-verification.json'),'utf8'))
assert.ok(skills.passed && skills.installer===meta.offline.file && skills.installerSha256===meta.offline.sha256 &&
  skills.skills.ownedPython && skills.skills.batchRows===3 &&
  skills.skills.executions.length===6 && skills.skills.executions.every(test=>test.passed),
  'Publish only after clean installed Skill entry points have executed successfully')
const readiness=JSON.parse(fs.readFileSync(path.join(evidence,'release-readiness.json'),'utf8'))
assert.ok(readiness.passed,'Installed feature acceptance has not passed')
assert.equal(readiness.sourceManifestSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(evidence,'installer-manifest.json'))).digest('hex'),'Payload changed after acceptance')
assert.match(meta.offline.sha256,/^[a-f0-9]{64}$/)
assert.match(meta.online.sha256,/^[a-f0-9]{64}$/)
const host='ubuntu@43.138.188.149'
const options=['-i',path.join(process.env.USERPROFILE,'.ssh/id_rsa_deploy'),'-o','BatchMode=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2']
const staging='/home/ubuntu/clinvexa-installer-'+releaseDate+'/'+meta.offline.sha256
const dest='/opt/medical-ai-platform/install APPS/clinvexa/releases/'+releaseDate+'/'+meta.offline.sha256
async function run(program,args){
  const code=await new Promise((resolve,reject)=>{const child=spawn(program,args,{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',resolve)})
  assert.equal(code,0,`${program} failed`)
}
async function alreadyUploaded(name, expectedHash) {
  const file = `${staging}/${name}`
  const result = await new Promise((resolve,reject)=>{
    const child=spawn('ssh',['-n',...options,host,`if [ -f '${file}' ]; then sha256sum '${file}'; fi`],{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let output='',error=''
    child.stdout.on('data',chunk=>output+=chunk)
    child.stderr.on('data',chunk=>error+=chunk)
    child.on('error',reject)
    child.on('exit',code=>resolve({code,output,error}))
  })
  assert.equal(result.code,0,'Could not verify staged upload: '+result.error)
  return result.output.trim().split(/\s+/)[0]===expectedHash
}
await run('ssh',[...options,host,`mkdir -p '${staging}'`])
for(const [kind,name] of [['offline','CLINVEXA-Offline-Setup.exe'],['online','CLINVEXA-Online-Setup.exe']]){
  if(await alreadyUploaded(name,meta[kind].sha256)) {
    console.log(`Reusing verified ${kind} upload`)
    continue
  }
  console.log(`Uploading ${kind}: ${meta[kind].bytes} bytes`)
  await run('scp',['-q',...options,meta[kind].file,`${host}:${staging}/${name}`])
}
const verification=JSON.parse(fs.readFileSync(path.join(evidence,'installer-verification.json'),'utf8'))
assert.ok(verification.passed && verification.installer===meta.offline.file,'Publish only after this exact installer passed verification')
const hashes=`${meta.offline.sha256}  CLINVEXA-Offline-Setup.exe\n${meta.online.sha256}  CLINVEXA-Online-Setup.exe\n`
const check=`printf '%s' '${hashes}' | sha256sum -c -`
await run('ssh',[...options,host,`set -eu\ncd '${staging}'\n${check}\nsudo -n install -D -m 644 CLINVEXA-Offline-Setup.exe '${dest}/CLINVEXA-Offline-Setup.exe'\nsudo -n install -D -m 644 CLINVEXA-Online-Setup.exe '${dest}/CLINVEXA-Online-Setup.exe'\ncd '${dest}'\n${check}`])
console.log('PUBLISHED_VERIFIED_RELEASE')
