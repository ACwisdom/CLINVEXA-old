import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { extractAll, createPackageWithOptions } from '@electron/asar'

const desktop = path.resolve(import.meta.dirname, '..')
const repo = path.resolve(desktop, '../..')
const evidence = path.resolve(repo, '../.codex-work/vision-release-20260918')
const installed = path.join(process.env.LOCALAPPDATA, 'Programs/CLINVEXA')
const before = path.join(evidence, 'before')
const staged = path.join(evidence, 'staged')
fs.mkdirSync(before, { recursive: true })
fs.mkdirSync(staged, { recursive: true })
if (!fs.existsSync(path.join(before, 'app.asar'))) {
  fs.copyFileSync(path.join(installed, 'resources/app.asar'), path.join(before, 'app.asar'))
  fs.cpSync(path.join(installed, 'resources/app.asar.unpacked'), path.join(before, 'app.asar.unpacked'), { recursive: true })
}
const extracted = path.join(evidence, 'application')
if (!fs.existsSync(extracted)) extractAll(path.join(before, 'app.asar'), extracted)
// Merge only the freshly built desktop output; preserve other bundled capabilities.
fs.cpSync(path.join(desktop, 'dist'), path.join(extracted, 'dist'), { recursive: true })
const metadataPath = path.join(extracted, 'package.json')
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
metadata.version = '2.0.2'
fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
await createPackageWithOptions(extracted, path.join(staged, 'app.asar'), { unpackDir: 'dist' })
const files = ['clinvexa_copilot.py', 'clinvexa_streaming.py', 'web_server.py']
for (const file of files) fs.copyFileSync(path.join(repo, 'hermes_cli', file), path.join(staged, file))
const hashes = {}
for (const file of ['app.asar', ...files]) hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(staged, file))).digest('hex')
fs.writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify({ version: '2.0.2', hashes }, null, 2))
console.log(JSON.stringify({ staged, before, hashes }))
