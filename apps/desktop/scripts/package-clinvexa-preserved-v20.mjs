import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const desktop = path.resolve(import.meta.dirname, '..')
const workspace = path.resolve(desktop, '../../..')
const baseline = path.join(desktop, 'release-copilot-v20/win-unpacked')
const evidence = path.join(workspace, '.codex-work/installer-20260917')
const source = path.join(evidence, 'release-source-kncube')
const output = path.join(evidence, 'pending')
fs.mkdirSync(evidence, { recursive: true })
fs.mkdirSync(output, { recursive: true })

export async function inventory(root) {
  const result = []
  async function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) {
        const hash = crypto.createHash('sha256')
        for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
        result.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: hash.digest('hex') })
      } else throw new Error(`Unsupported packaged entry: ${file}`)
    }
  }
  await walk(root)
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

if (!fs.existsSync(source)) fs.cpSync(baseline, source, { recursive: true, preserveTimestamps: true })
fs.copyFileSync(path.join(desktop, '../../scripts/install.ps1'), path.join(source, 'resources/clinvexa-runtime/scripts/install.ps1'))
fs.copyFileSync(path.join(desktop, 'dist/electron-main.mjs'), path.join(source, 'resources/app.asar.unpacked/dist/electron-main.mjs'))
fs.copyFileSync(path.join(evidence, 'PortableGit-2.54.0-64-bit.7z.exe'), path.join(source, 'resources/clinvexa-dependencies/PortableGit-2.54.0-64-bit.7z.exe'))
const original = JSON.parse(fs.readFileSync(path.join(evidence, 'source-manifest.json'), 'utf8'))
const before = await inventory(source)
const staged = new Map(before.map(file => [file.path, file]))
const brandingChanges = JSON.parse(fs.readFileSync(path.join(evidence, 'branding-changes.json'), 'utf8'))
for (const file of original) {
  if (!staged.has(file.path)) throw new Error(`Original file omitted: ${file.path}`)
  if (!['resources/clinvexa-runtime/scripts/install.ps1', 'resources/app.asar.unpacked/dist/electron-main.mjs', ...brandingChanges].includes(file.path) && staged.get(file.path).sha256 !== file.sha256) throw new Error(`Original payload changed: ${file.path}`)
}
fs.writeFileSync(path.join(evidence, 'installer-manifest.json'), JSON.stringify(before, null, 2))
console.log(JSON.stringify({ source, files: before.length, bytes: before.reduce((sum, file) => sum + file.bytes, 0) }))
const compiler = [process.env.INNO_SETUP_COMPILER, path.join(process.env.LOCALAPPDATA, 'Programs/Inno Setup 6/ISCC.exe')].find(p => p && fs.existsSync(p))
if (!compiler) throw new Error('Inno Setup compiler missing')
const result = spawnSync(compiler, [
  `/DSourceDir=${source}`, `/DOutputDir=${output}`, `/DIconFile=${path.join(desktop, 'assets/icon.ico')}`,
  '/DAppVersion=2.0.1', '/DOutputName=CLINVEXA-2.0.1-20260917-Setup', '/DCompressionMode=lzma2/normal',
  path.join(desktop, 'scripts/clinvexa-installer.iss'),
], { windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
fs.writeFileSync(path.join(evidence, 'compiler.log'), (result.stdout || '') + (result.stderr || ''))
if (result.status !== 0) throw new Error(`Compiler failed: ${result.error || (result.stdout || '').slice(-4000) + (result.stderr || '')}`)
const after = await inventory(source)
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source changed during packaging')
const installer = path.join(output, 'CLINVEXA-2.0.1-20260917-Setup.exe')
const metadata = { installer, bytes: fs.statSync(installer).size, sourceFiles: before.length, sourceBytes: before.reduce((sum, file) => sum + file.bytes, 0), contentRemoved: false }
fs.writeFileSync(path.join(evidence, 'package-result.json'), JSON.stringify(metadata, null, 2))
console.log(JSON.stringify(metadata))
