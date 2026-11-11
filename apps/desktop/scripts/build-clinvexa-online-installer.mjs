import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const desktop = path.resolve(import.meta.dirname, '..')
const evidence = process.env.CLINVEXA_RELEASE_DIR || path.resolve(desktop, '../../../.codex-work/installer-20260917')
const version = process.env.CLINVEXA_RELEASE_VERSION || '2.0.1'
const releaseDate = process.env.CLINVEXA_RELEASE_DATE || '20260917'
const full = path.join(evidence, `pending/CLINVEXA-${version}-${releaseDate}-Setup.exe`)
const skills = JSON.parse(fs.readFileSync(path.join(evidence, 'skill-runtime-verification.json'), 'utf8'))
assert.ok(skills.passed && path.resolve(skills.installer) === path.resolve(full),
  'Online installer requires this exact offline payload to pass fresh installed Skill execution')
const hash = crypto.createHash('sha256')
for await (const data of fs.createReadStream(full)) hash.update(data)
const sha256 = hash.digest('hex')
assert.equal(sha256, skills.installerSha256, 'Offline installer changed after Skill verification')
const size = fs.statSync(full).size
const url = `https://ai.keningcube.com/install-apps/clinvexa/releases/${releaseDate}/${sha256}/CLINVEXA-Offline-Setup.exe`
const generated = path.join(evidence, 'online-build')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated,'Release.cs'), `namespace CLINVEXA.Installation { internal static class Release { public const string Url = "${url}"; public const string Hash = "${sha256}"; public const long Length = ${size}L; } }`)
fs.writeFileSync(path.join(generated,'Metadata.cs'), `[assembly:System.Reflection.AssemblyTitle("CLINVEXA 在线安装程序")]
[assembly:System.Reflection.AssemblyProduct("CLINVEXA")]
[assembly:System.Reflection.AssemblyCompany("CLINVEXA")]
[assembly:System.Reflection.AssemblyVersion("${version}.0")]
[assembly:System.Reflection.AssemblyFileVersion("${version}.0")]`)
fs.writeFileSync(path.join(generated,'app.manifest'), `<?xml version="1.0" encoding="utf-8"?><assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1"><assemblyIdentity version="2.0.0.0" name="CLINVEXA.OnlineInstaller"/><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo><compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application><supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application></compatibility></assembly>`)
const compiler = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
const output = path.join(evidence, `pending/CLINVEXA-${version}-${releaseDate}-Online-Setup.exe`)
execFileSync(compiler, ['/nologo','/target:winexe','/platform:anycpu','/optimize+', `/out:${output}`, `/win32manifest:${path.join(generated,'app.manifest')}`, `/win32icon:${path.join(desktop,'assets/icon.ico')}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', ...['Program.cs','Download.cs'].map(f => path.join(import.meta.dirname,'online-installer',f)), path.join(generated,'Release.cs'),path.join(generated,'Metadata.cs')], { windowsHide: true, stdio: 'inherit' })
const result = { offline: { file:full, bytes:size, sha256, url }, online: { file:output, bytes:fs.statSync(output).size, sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex') } }
fs.writeFileSync(path.join(evidence,'release-metadata.json'), JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
