import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import os from 'node:os'
import { spawn } from 'node:child_process'

const root = process.env.CLINVEXA_RELEASE_DIR || path.resolve(import.meta.dirname, '../../../../.codex-work/installer-20260917')
const meta = JSON.parse(fs.readFileSync(path.join(root, 'package-result.json'), 'utf8'))
// Keep the verification destination comparable to the supported per-user
// install path; nesting the full payload under the long evidence path exceeds
// Win32 MAX_PATH for the inherited documentation/browser-cache resources.
const target = process.env.CLINVEXA_VERIFY_TARGET || fs.mkdtempSync(path.join(os.tmpdir(), 'dc-payload-'))
const log = path.join(root, 'actual-installer.log')
fs.mkdirSync(target, { recursive: true })
const code = await new Promise((resolve, reject) => {
  const child = spawn(meta.installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCLOSEAPPLICATIONS', '/NOICONS', '/VerifyOnly=1', `/DIR=${target}`, `/LOG=${log}`], { windowsHide: true, stdio: 'ignore' })
  child.on('error', reject); child.on('exit', resolve)
})
assert.equal(code, 0, `Installer exited ${code}; inspect ${log}`)
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'installer-manifest.json'), 'utf8'))
const observed = []
function walk(directory) { for (const entry of fs.readdirSync(directory,{withFileTypes:true})) { const file = path.join(directory,entry.name); if(entry.isDirectory()) walk(file); else observed.push(path.relative(target,file).replaceAll('\\','/')) } }
walk(target)
assert.deepEqual(observed.sort(),manifest.map(file => file.path).sort())
for (const file of manifest) {
  const full = path.join(target,file.path)
  assert.equal(fs.statSync(full).size, file.bytes, file.path)
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(full)) hash.update(chunk)
  assert.equal(hash.digest('hex'), file.sha256, file.path)
}
const result = { passed: true, installer: meta.installer, target, files: manifest.length, bytes: manifest.reduce((n,file) => n+file.bytes,0), test: 'Real silent install followed by complete file-list and SHA256 comparison' }
fs.writeFileSync(path.join(root,'installer-verification.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
