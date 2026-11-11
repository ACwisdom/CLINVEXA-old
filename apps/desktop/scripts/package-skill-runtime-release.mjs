import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {extractAll, createPackageWithOptions} from '@electron/asar'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const root = process.env.CLINVEXA_RELEASE_DIR
const baseline = process.env.CLINVEXA_RELEASE_BASELINE
const version = process.env.CLINVEXA_RELEASE_VERSION
const date = process.env.CLINVEXA_RELEASE_DATE
const compression = process.env.CLINVEXA_COMPRESSION_MODE || 'lzma2/normal'
assert.ok(['lzma2/normal','lzma2/fast'].includes(compression))
assert.ok(root && baseline, 'Explicit release directory and verified application baseline required')
assert.match(version || '', /^\d+\.\d+\.\d+$/)
assert.match(date || '', /^\d{8}$/)
const source = path.join(root, 'release-source')
assert.ok(!fs.existsSync(source) || process.env.CLINVEXA_RESUME_STAGING === '1', 'Use a fresh staging directory')
fs.mkdirSync(root, {recursive:true})
const hash = async file => {
  const h = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}
async function inventory(dir) {
  const result=[]
  async function walk(current) {
    for(const entry of fs.readdirSync(current,{withFileTypes:true})) {
      const file=path.join(current,entry.name)
      if(entry.isDirectory()) await walk(file)
      else if(entry.isFile()) result.push({path:path.relative(dir,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:await hash(file)})
      else throw Error('Unexpected payload entry: '+file)
    }
  }
  await walk(dir)
  return result.sort((a,b)=>a.path.localeCompare(b.path))
}
// Copy the verified application payload only, never the mutable user runtime.
const excluded = file => /^unins\d+\.(exe|dat|msg)$/i.test(path.basename(file)) ||
  ['.hermes','chrome-headless-profile'].includes(path.basename(file))
if(!fs.existsSync(source)) fs.cpSync(baseline, source, {recursive:true,filter:file=>!excluded(file)})
const before=await inventory(source)
assert.ok(!before.some(file=>/(^|\/)(\.hermes|chrome-headless-profile)(\/|$)/.test(file.path)), 'User data must not be released')
const changed=['scripts/clinvexa_live_voice_bundle.py','clinvexa/pyproject.toml','scripts/install.ps1']
for(const file of changed) fs.copyFileSync(path.join(repo,file),path.join(source,'resources/clinvexa-runtime',file))
const application=path.join(root,'application')
extractAll(path.join(source,'resources/app.asar'),application)
const metadata=JSON.parse(fs.readFileSync(path.join(application,'package.json'),'utf8'))
metadata.version=version
fs.writeFileSync(path.join(application,'package.json'),JSON.stringify(metadata,null,2))
await createPackageWithOptions(application,path.join(source,'resources/app.asar'),{unpackDir:'dist'})
const stamp={schemaVersion:1,commit:(await hash(path.join(source,'resources/app.asar'))).slice(0,40),branch:`release/${version}`,builtAt:new Date().toISOString(),dirty:false,source:'content-hash'}
fs.writeFileSync(path.join(source,'resources/install-stamp.json'),JSON.stringify(stamp,null,2))
execFileSync(path.join(repo,'node_modules/rcedit/bin/rcedit-x64.exe'),[path.join(source,'CLINVEXA.exe'),'--set-file-version',version+'.0','--set-product-version',version+'.0'],{windowsHide:true})
const files=await inventory(source)
const byPath=new Map(files.map(f=>[f.path,f]))
for(const file of before) {
  assert.ok(byPath.has(file.path),'Original resource omitted: '+file.path)
  if(!['CLINVEXA.exe','resources/app.asar','resources/install-stamp.json',...changed.map(p=>'resources/clinvexa-runtime/'+p)].includes(file.path))
    assert.equal(byPath.get(file.path).sha256,file.sha256,'Unexpected resource change: '+file.path)
}
fs.writeFileSync(path.join(root,'installer-manifest.json'),JSON.stringify(files,null,2))
fs.writeFileSync(path.join(root,'stage-result.json'),JSON.stringify({version,source,baseline,files:files.length,originalResourcesPreserved:true,changed},null,2))
const installer=path.join(root,`pending/CLINVEXA-${version}-${date}-Setup.exe`)
fs.mkdirSync(path.dirname(installer),{recursive:true})
const log=fs.openSync(path.join(root,'compiler.log'),'w')
console.log('Staged '+files.length+' preserved files; compiling offline installer')
try {
 execFileSync(path.join(process.env.LOCALAPPDATA,'Programs/Inno Setup 6/ISCC.exe'),[
  `/DSourceDir=${source}`,`/DOutputDir=${path.dirname(installer)}`,`/DOutputName=CLINVEXA-${version}-${date}-Setup`,`/DAppVersion=${version}`,
  `/DIconFile=${path.join(desktop,'assets/icon.ico')}`,`/DCompressionMode=${compression}`,path.join(desktop,'scripts/clinvexa-installer.iss')
 ],{windowsHide:true,stdio:['ignore',log,log]})
} finally {fs.closeSync(log)}
assert.deepEqual(await inventory(source),files,'Source changed during packaging')
fs.writeFileSync(path.join(root,'package-result.json'),JSON.stringify({version,installer,bytes:fs.statSync(installer).size,contentRemoved:false},null,2))
console.log(JSON.stringify({version,installer,files:files.length}))
