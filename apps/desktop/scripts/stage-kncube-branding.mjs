import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { extractAll, createPackageWithOptions } from '@electron/asar'

const desktop = path.resolve(import.meta.dirname, '..')
const evidence = path.resolve(desktop, '../../../.codex-work/installer-20260917')
const source = path.join(evidence,'release-source-kncube')
if (!fs.existsSync(source)) fs.cpSync(path.join(evidence,'release-source'),source,{recursive:true,preserveTimestamps:true})
const assets = path.join(desktop,'assets')
const extract = path.join(evidence,'asar-kncube')
if (!fs.existsSync(extract)) extractAll(path.join(source,'resources/app.asar'),extract)
const changes = []
function write(file,bytes,root) {
  fs.writeFileSync(file,bytes)
  if (root === source) changes.push(path.relative(source,file).replaceAll('\\','/'))
}
const png = fs.readFileSync(path.join(assets,'icon.png'))
const ico = fs.readFileSync(path.join(assets,'icon.ico'))
const jpg = fs.readFileSync(path.join(assets,'brand/kncube-source.jpg'))
// PNG-containing ICNS is a standard macOS icon container. Keep cross-platform
// resources consistent even though this release delivers Windows installers.
const icns = Buffer.alloc(16+png.length)
icns.write('icns',0); icns.writeUInt32BE(icns.length,4); icns.write('ic10',8); icns.writeUInt32BE(png.length+8,12); png.copy(icns,16)
fs.writeFileSync(path.join(assets,'icon.icns'),icns)
const pngNames = new Set(['icon.png','apple-touch-icon.png','hermes.png','hermes-sprite.png','32x32.png','128x128.png','128x128@2x.png'])
function replace(root) {
  function visit(dir) {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name)
      if (entry.isDirectory()) visit(file)
      else if (pngNames.has(entry.name) || /^hermes-frame-\d+\.png$/.test(entry.name)) write(file,png,root)
      else if (entry.name==='nous-girl.jpg') write(file,jpg,root)
      else if (entry.name==='icon.ico' || entry.name==='favicon.ico') write(file,ico,root)
      else if (entry.name==='icon.icns') write(file,icns,root)
    }
  }
  visit(root)
}
replace(extract)
const appPackage = path.join(extract,'package.json')
const appMetadata = JSON.parse(fs.readFileSync(appPackage,'utf8'))
appMetadata.version = '2.0.1'
fs.writeFileSync(appPackage,JSON.stringify(appMetadata,null,2))
replace(source)
replace(path.join(desktop,'public'))
// Keep direct renderer previews and future packages aligned with the same
// application artwork even when they consume dist without rebuilding first.
replace(path.join(desktop,'dist'))
replace(path.join(desktop,'../../apps/bootstrap-installer/public'))
replace(path.join(desktop,'../../apps/bootstrap-installer/src-tauri/icons'))
fs.copyFileSync(path.join(assets,'icon.ico'),path.join(desktop,'../../web/public/favicon.ico'))
fs.copyFileSync(path.join(desktop,'dist/electron-main.mjs'),path.join(extract,'dist/electron-main.mjs'))
for (const dir of ['dist', 'public']) {
  fs.copyFileSync(path.join(desktop,'public/kncube-branding.css'),path.join(extract,dir,'kncube-branding.css'))
}
const rendererHtml = path.join(extract,'dist/index.html')
let html = fs.readFileSync(rendererHtml,'utf8')
if (!html.includes('kncube-branding.css')) html = html.replace('</head>', '<link rel="stylesheet" href="./kncube-branding.css" /></head>')
fs.writeFileSync(rendererHtml,html)
changes.push('resources/app.asar.unpacked/dist/index.html')
// Recreate ASAR metadata as well as its unpacked files, so every icon and
// resource checksum describes the actual supplied asset.
await createPackageWithOptions(extract,path.join(source,'resources/app.asar'), { unpackDir: 'dist' })
changes.push('resources/app.asar')
const exe=path.join(source,'CLINVEXA.exe')
function sections(file) {
  const data=fs.readFileSync(file), pe=data.readUInt32LE(60), count=data.readUInt16LE(pe+6), start=pe+24+data.readUInt16LE(pe+20)
  const result={}
  for(let i=0;i<count;i++) {
    const at=start+i*40, name=data.subarray(at,at+8).toString().replace(/\0/g,''), size=data.readUInt32LE(at+16), offset=data.readUInt32LE(at+20)
    if(name!=='.rsrc') result[name]=crypto.createHash('sha256').update(data.subarray(offset,offset+size)).digest('hex')
  }
  return result
}
const before=sections(exe)
execFileSync(path.join(desktop,'../../node_modules/rcedit/bin/rcedit-x64.exe'),[exe,'--set-icon',path.join(assets,'icon.ico'),'--set-file-version','2.0.1.0','--set-product-version','2.0.1.0'],{windowsHide:true})
assert.deepEqual(sections(exe),before,'Changing the icon must not change executable code/data sections')
changes.push('CLINVEXA.exe')
fs.writeFileSync(path.join(evidence,'branding-changes.json'),JSON.stringify([...new Set(changes)].sort(),null,2))
console.log(JSON.stringify({source,changed:changes.length,executableCodePreserved:true}))
