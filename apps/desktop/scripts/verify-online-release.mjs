import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'

const desktop=path.resolve(import.meta.dirname,'..')
const evidence=process.env.CLINVEXA_RELEASE_DIR || path.resolve(desktop,'../../../.codex-work/installer-20260917')
const meta=JSON.parse(fs.readFileSync(path.join(evidence,'release-metadata.json'),'utf8'))
const head=await fetch(meta.offline.url,{method:'HEAD'})
assert.equal(head.status,200)
assert.equal(Number(head.headers.get('content-length')),meta.offline.bytes)
assert.equal(head.headers.get('accept-ranges'),'bytes')
const range=await fetch(meta.offline.url,{headers:{Range:'bytes=0-4095'}})
assert.equal(range.status,206)
const prefix=Buffer.alloc(4096)
const fd=fs.openSync(meta.offline.file,'r');fs.readSync(fd,prefix,0,4096,0);fs.closeSync(fd)
assert.deepEqual(Buffer.from(await range.arrayBuffer()),prefix)

// Exercise the shipped downloader against its REAL pinned HTTPS URL with a
// multi-gigabyte resume offset. Seed verified local bytes and download the tail.
const target=path.join(evidence,'download-tests/real-https-resume.exe')
fs.mkdirSync(path.dirname(target),{recursive:true})
fs.copyFileSync(meta.offline.file,target+'.part')
fs.truncateSync(target+'.part',meta.offline.bytes-65536)
const compiler=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
const test=path.join(evidence,'download-tests/TestDownload.exe')
execFileSync(compiler,['/nologo',`/out:${test}`,path.join(import.meta.dirname,'online-installer/Download.cs'),path.join(import.meta.dirname,'online-installer/TestDownload.cs')],{windowsHide:true})
const result=await new Promise((resolve,reject)=>{
  const child=spawn(test,[meta.offline.url,target,String(meta.offline.bytes),meta.offline.sha256],{windowsHide:true})
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data)
  child.on('error',reject);child.on('exit',code=>resolve({code,output}))
})
assert.equal(result.code,0,result.output)
const onlineUrl=meta.offline.url.replace('CLINVEXA-Offline-Setup.exe','CLINVEXA-Online-Setup.exe')
const online=await fetch(onlineUrl)
assert.equal(online.status,200)
assert.deepEqual(Buffer.from(await online.arrayBuffer()),fs.readFileSync(meta.online.file))
const proof={passed:true,offlineSha256:meta.offline.sha256,onlineSha256:meta.online.sha256,headStatus:head.status,rangeStatus:range.status,resumeOffset:meta.offline.bytes-65536,verifiedCompletePayload:true,onlineUrl,offlineUrl:meta.offline.url}
fs.writeFileSync(path.join(evidence,'online-verification.json'),JSON.stringify(proof,null,2))
console.log(JSON.stringify(proof,null,2))
