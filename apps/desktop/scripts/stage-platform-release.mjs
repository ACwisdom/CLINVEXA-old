import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {extractAll,createPackageWithOptions} from '@electron/asar'

const workspace=path.resolve(import.meta.dirname,'../../../..')
const desktop=path.resolve(import.meta.dirname,'..')
const output='C:/Users/home/AppData/Local/Temp/clinvexa-release-20260921'
const base=path.join(workspace,'.codex-work/voice-repair-20260918')
const hotfix=path.join(workspace,'.codex-work/visual-repair-20260919/hotfix')
const source=path.join(output,'release-source')
const hash=async file=>{const h=crypto.createHash('sha256');for await(const c of fs.createReadStream(file))h.update(c);return h.digest('hex')}
fs.mkdirSync(output,{recursive:true})
if(!fs.existsSync(source))fs.cpSync(path.join(base,'release-source'),source,{recursive:true})
const manifest=JSON.parse(fs.readFileSync(path.join(hotfix,'manifest.json'),'utf8'))
assert.equal(await hash(path.join(hotfix,'app.asar')),manifest.appAsar)
assert.equal(await hash(path.join(hotfix,'clinvexa_copilot.py')),manifest.visualBackend)
const app=path.join(output,'application')
if(!fs.existsSync(app))extractAll(path.join(hotfix,'app.asar'),app)
const pkg=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));pkg.version='2.0.5'
fs.writeFileSync(path.join(app,'package.json'),JSON.stringify(pkg,null,2))
await createPackageWithOptions(app,path.join(source,'resources/app.asar'),{unpackDir:'dist'})
fs.copyFileSync(path.join(hotfix,'clinvexa_copilot.py'),path.join(source,'resources/clinvexa-runtime/hermes_cli/clinvexa_copilot.py'))
const stamp={schemaVersion:1,commit:manifest.appAsar.slice(0,40),branch:'release/2.0.5',builtAt:new Date().toISOString(),dirty:false,source:'content-hash'}
fs.writeFileSync(path.join(source,'resources/install-stamp.json'),JSON.stringify(stamp,null,2))
execFileSync(path.join(workspace,'hermes-agent-main/node_modules/rcedit/bin/rcedit-x64.exe'),[path.join(source,'CLINVEXA.exe'),'--set-icon',path.join(desktop,'assets/icon.ico'),'--set-file-version','2.0.5.0','--set-product-version','2.0.5.0'],{windowsHide:true})
const files=[]
async function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else files.push({path:path.relative(source,f).replaceAll('\\','/'),bytes:fs.statSync(f).size,sha256:await hash(f)})}}
await walk(source)
const byPath=new Map(files.map(f=>[f.path,f]))
const old=JSON.parse(fs.readFileSync(path.join(base,'installer-manifest.json'),'utf8'))
for(const f of old){assert.ok(byPath.has(f.path),`Missing resource: ${f.path}`);if(!['CLINVEXA.exe','resources/install-stamp.json','resources/clinvexa-runtime/hermes_cli/clinvexa_copilot.py'].includes(f.path)&&!f.path.startsWith('resources/app.asar'))assert.equal(byPath.get(f.path).sha256,f.sha256,f.path)}
fs.writeFileSync(path.join(output,'installer-manifest.json'),JSON.stringify(files,null,2))
fs.writeFileSync(path.join(output,'stage-result.json'),JSON.stringify({version:'2.0.5',source,files:files.length,originalResourcesPreserved:true,hotfix:manifest},null,2))
fs.mkdirSync(path.join(output,'pending'),{recursive:true})
const installer=path.join(output,'pending/CLINVEXA-2.0.5-20260921-Setup.exe')
const compiler=path.join(process.env.LOCALAPPDATA,'Programs/Inno Setup 6/ISCC.exe')
const log=fs.openSync(path.join(output,'compiler.log'),'w')
execFileSync(compiler,[`/DSourceDir=${source}`,`/DOutputDir=${path.dirname(installer)}`,'/DOutputName=CLINVEXA-2.0.5-20260921-Setup','/DAppVersion=2.0.5',`/DIconFile=${path.join(desktop,'assets/icon.ico')}`,path.join(desktop,'scripts/clinvexa-installer.iss')],{windowsHide:true,stdio:['ignore',log,log]})
fs.closeSync(log)
fs.writeFileSync(path.join(output,'package-result.json'),JSON.stringify({version:'2.0.5',contentRemoved:false,bytes:fs.statSync(installer).size,installer},null,2))
console.log(JSON.stringify({output,installer,files:files.length}))
