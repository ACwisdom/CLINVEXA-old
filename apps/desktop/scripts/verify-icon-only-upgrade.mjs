import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {listPackage,extractFile,statFile} from '@electron/asar'
const evidence=path.resolve(import.meta.dirname,'../../../../.codex-work/installer-20260917')
const read=file=>JSON.parse(fs.readFileSync(path.join(evidence,file),'utf8'))
const oldManifest=read('previous-wordmark-evidence/installer-manifest.json')
const manifest=read('installer-manifest.json')
const oldFiles=new Map(oldManifest.map(file=>[file.path,file.sha256]))
assert.deepEqual([...oldFiles.keys()].sort(),manifest.map(file=>file.path).sort())
const changes=manifest.filter(file=>oldFiles.get(file.path)!==file.sha256).map(file=>file.path)
const allowed=new Set([...read('branding-changes.json'),'resources/app.asar.unpacked/dist/kncube-branding.css'])
for(const file of changes) assert.ok(allowed.has(file),`Non-branding payload changed: ${file}`)
const old=path.join(process.env.LOCALAPPDATA,'Programs/CLINVEXA/resources/app.asar')
const current=path.join(evidence,'release-source-kncube/resources/app.asar')
assert.deepEqual(listPackage(old),listPackage(current))
const icon=/(?:icon\.(?:png|ico|icns)|apple-touch-icon\.png|nous-girl\.jpg|hermes(?:-sprite|-frame-\d+)?\.png|kncube-branding\.css)$/
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
let unchanged=0
for(const name of listPackage(old)){
  const key=name.replace(/^[/\\]/,'')
  if(typeof statFile(old,key).size!=='number') continue
  const before=extractFile(old,key),after=extractFile(current,key)
  if(sha(before)===sha(after)){unchanged++;continue}
  if(key==='package.json'){
    const previous=JSON.parse(before),next=JSON.parse(after)
    assert.equal(next.version,'2.0.1');next.version=previous.version
    assert.deepEqual(next,previous)
  } else assert.ok(icon.test(key),`Application logic changed: ${key}`)
}
const result={passed:true,payloadFilesPreserved:manifest.length,unchangedApplicationFiles:unchanged,onlyArtworkStylesAndVersionChanged:true,changes}
fs.writeFileSync(path.join(evidence,'icon-only-upgrade-verification.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
