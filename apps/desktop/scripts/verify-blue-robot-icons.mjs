import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
const desktop=path.resolve(import.meta.dirname,'..')
const evidence=process.env.CLINVEXA_RELEASE_DIR || path.resolve(desktop,'../../../.codex-work/installer-20260917')
const meta=JSON.parse(fs.readFileSync(path.join(evidence,'release-metadata.json'),'utf8'))
const ico=fs.readFileSync(path.join(desktop,'assets/icon.ico'))
const frames=Array.from({length:ico.readUInt16LE(4)},(_,i)=>{
  const offset=6+16*i
  return ico.subarray(ico.readUInt32LE(offset+12),ico.readUInt32LE(offset+12)+ico.readUInt32LE(offset+8))
})
const targets=[path.join(evidence,process.env.CLINVEXA_RELEASE_DIR?'release-source/CLINVEXA.exe':'release-source-kncube/CLINVEXA.exe'),meta.offline.file,meta.online.file]
const results=[]
for(const target of targets){
  const fd=fs.openSync(target,'r')
  const size=fs.fstatSync(fd).size
  // The app's resource section is near its end; installer resources are in the
  // launcher before the compressed payload. No full 2.5 GiB allocation needed.
  const length=Math.min(size,target===targets[0]?size:4*1024*1024)
  const bytes=Buffer.alloc(length)
  fs.readSync(fd,bytes,0,length,0);fs.closeSync(fd)
  const count=frames.filter(frame=>bytes.indexOf(frame)>=0).length
  assert.equal(count,frames.length,`Latest supplied icon frame missing from ${target}`)
  results.push({file:target,verifiedIconFrames:count})
}
fs.writeFileSync(path.join(evidence,'blue-robot-native-icons.json'),JSON.stringify({passed:true,results},null,2))
console.log(JSON.stringify({passed:true,results}))
