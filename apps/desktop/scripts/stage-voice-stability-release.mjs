import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { extractAll, createPackageWithOptions } from '@electron/asar'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const workspace = path.dirname(repo)
const evidence = path.join(workspace, '.codex-work/voice-repair-20260918')
const source = path.join(evidence, 'release-source')
const baseline = path.join(workspace, '.codex-work/installer-20260917/release-source-kncube')
const installed = path.join(process.env.LOCALAPPDATA, 'Programs/CLINVEXA')
if (!fs.existsSync(source)) fs.cpSync(baseline, source, { recursive: true })
const extracted = path.join(evidence, 'application')
if (!fs.existsSync(extracted)) extractAll(path.join(installed, 'resources/app.asar'), extracted)
fs.cpSync(path.join(desktop, 'dist'), path.join(extracted, 'dist'), { recursive: true })
const metadata = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'))
metadata.version = '2.0.4'
fs.writeFileSync(path.join(extracted, 'package.json'), JSON.stringify(metadata, null, 2))
await createPackageWithOptions(extracted, path.join(source, 'resources/app.asar'), { unpackDir: 'dist' })
const changed = ['clinvexa/src/clinvexa/live_asr.py', 'clinvexa/src/clinvexa/consultations.py', 'clinvexa/src/clinvexa/main.py',
  'hermes_cli/clinvexa_copilot.py', 'hermes_cli/clinvexa_streaming.py', 'hermes_cli/web_server.py', 'tools/computer_use/cua_backend.py', 'scripts/install.ps1', 'scripts/clinvexa_live_voice_bundle.py', 'scripts/clinvexa_document_checks.py', 'docs/CLINVEXA-医疗场景与功能介绍.md', 'clinvexa/pyproject.toml']
for (const file of changed) fs.copyFileSync(path.join(repo, file), path.join(source, 'resources/clinvexa-runtime', file))
const voiceSource = path.join(evidence, 'clinvexa-live-voice')
const voiceDest = path.join(source, 'resources/clinvexa-dependencies/clinvexa-live-voice')
const voiceManifest = JSON.parse(fs.readFileSync(path.join(voiceSource, 'manifest.json'), 'utf8'))
if (!voiceManifest.files.every(f => fs.existsSync(path.join(voiceDest, f.path)) && fs.statSync(path.join(voiceDest, f.path)).size === f.bytes)) {
  fs.cpSync(voiceSource, voiceDest, { recursive: true })
}
fs.copyFileSync(path.join(voiceSource, 'manifest.json'), path.join(voiceDest, 'manifest.json'))
fs.copyFileSync(path.join(desktop, 'build/install-stamp.json'), path.join(source, 'resources/install-stamp.json'))
execFileSync(path.join(repo, 'node_modules/rcedit/bin/rcedit-x64.exe'), [path.join(source, 'CLINVEXA.exe'), '--set-icon', path.join(desktop, 'assets/icon.ico'), '--set-file-version', '2.0.4.0', '--set-product-version', '2.0.4.0'], { windowsHide: true })
const files = []
async function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir,entry.name)
    if (entry.isDirectory()) await walk(file)
    else { const hash=crypto.createHash('sha256'); for await(const chunk of fs.createReadStream(file)) hash.update(chunk); files.push({path:path.relative(source,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:hash.digest('hex')}) }
  }
}
await walk(source)
const old = JSON.parse(fs.readFileSync(path.join(workspace, '.codex-work/installer-20260917/installer-manifest.json'),'utf8'))
const current = new Map(files.map(file=>[file.path,file]))
for(const file of old) {
  if(!current.has(file.path)) throw new Error(`Original resource omitted: ${file.path}`)
  const allowed = file.path==='CLINVEXA.exe' || file.path==='resources/install-stamp.json' || file.path.startsWith('resources/app.asar') || changed.some(p=>file.path===`resources/clinvexa-runtime/${p}`)
  if(!allowed && current.get(file.path).sha256!==file.sha256) throw new Error(`Unexpected resource change: ${file.path}`)
}
fs.writeFileSync(path.join(evidence,'installer-manifest.json'),JSON.stringify(files,null,2))
fs.writeFileSync(path.join(evidence,'stage-result.json'),JSON.stringify({version:'2.0.4',source,files:files.length,originalResourcesPreserved:true,changed},null,2))
console.log(JSON.stringify({source,files:files.length,originalResourcesPreserved:true}))
