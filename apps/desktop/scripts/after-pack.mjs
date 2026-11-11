/**
 * after-pack.mjs — electron-builder afterPack hook.
 *
 * Stamps the Hermes icon + identity onto the packed Windows Hermes.exe via
 * rcedit (delegated to set-exe-identity.mjs). This runs for EVERY packed build
 * — first install, `hermes desktop`, the installer's --update rebuild, and a
 * dev's manual `npm run pack` — so the branded exe can never silently revert
 * to the stock "Electron" icon/name (the bug when the stamp lived only in
 * install.ps1, which the update path doesn't use).
 *
 * Windows-only: rcedit edits PE resources, irrelevant on macOS/Linux where the
 * app identity comes from the bundle Info.plist / desktop entry. Best-effort:
 * a stamp failure must never fail an otherwise-good build (worst case is the
 * stock icon, not a broken app), so we log and resolve rather than throw.
 *
 * electron-builder passes a context with:
 *   - electronPlatformName: 'win32' | 'darwin' | 'linux'
 *   - appOutDir:            the unpacked app directory for this target
 *   - packager.appInfo.productFilename: the exe basename (e.g. 'Hermes')
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { stampExeIdentity } from './set-exe-identity.mjs'

export default async function afterPack(context) {
  const runtimeRoot = path.join(context.appOutDir, 'resources', 'clinvexa-runtime')
  const catalogPath = path.join(runtimeRoot, 'skills', 'clinvexa', 'catalog.json')

  for (const requiredRuntimeFile of [
    path.join('clinvexa', 'src', 'clinvexa', 'main.py'),
    path.join('hermes_cli', 'web_server.py'),
    path.join('tui_gateway', 'server.py'),
    path.join('tui_gateway', 'methods_session.py'),
    path.join('tools', 'transcription_tools.py'),
    path.join('tools', 'computer_use', 'tool.py')
  ]) {
    const candidate = path.join(runtimeRoot, requiredRuntimeFile)
    if (!fs.existsSync(candidate)) {
      throw new Error(`CLINVEXA package is missing Source A runtime file: ${candidate}`)
    }
  }

  const gatewaySource = fs.readFileSync(path.join(runtimeRoot, 'tui_gateway', 'server.py'), 'utf8')
  const contract = Number(gatewaySource.match(/^DESKTOP_BACKEND_CONTRACT\s*=\s*(\d+)\s*$/m)?.[1] || 0)
  if (contract < 5) {
    throw new Error(`CLINVEXA package backend contract is ${contract}; desktop requires at least 5`)
  }
  console.log(`[after-pack] verified CLINVEXA backend contract ${contract}`)

  if (!fs.existsSync(catalogPath)) {
    throw new Error(`CLINVEXA package is missing its medical Skill catalog: ${catalogPath}`)
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const skills = Array.isArray(catalog?.skills) ? catalog.skills : []

  if (skills.length === 0) {
    throw new Error('CLINVEXA package contains an empty medical Skill catalog')
  }

  for (const skill of skills) {
    const skillFile = path.join(runtimeRoot, 'skills', 'clinvexa', String(skill.source || ''), 'SKILL.md')
    if (!fs.existsSync(skillFile)) {
      throw new Error(`CLINVEXA package is missing Skill ${skill.name || skill.source}: ${skillFile}`)
    }
  }

  for (const deterministicSkill of ['record-structuring', 'outpatient-note-draft', 'followup-plan']) {
    const runner = path.join(runtimeRoot, 'skills', 'clinvexa', deterministicSkill, 'scripts', 'run.py')
    if (!fs.existsSync(runner)) {
      throw new Error(`CLINVEXA package is missing deterministic Skill runner: ${runner}`)
    }
  }
  const deterministicRuntime = path.join(runtimeRoot, 'clinvexa', 'src', 'clinvexa', 'deterministic_skills.py')
  if (!fs.existsSync(deterministicRuntime)) {
    throw new Error(`CLINVEXA package is missing deterministic medical Skill runtime: ${deterministicRuntime}`)
  }

  console.log(`[after-pack] verified ${skills.length} bundled CLINVEXA medical Skills`)

  if (context.electronPlatformName !== 'win32') {
    return
  }

  const dependenciesArchive = path.join(
    context.appOutDir,
    'resources',
    'clinvexa-dependencies',
    'windows-x64.tar.gz'
  )
  if (!fs.existsSync(dependenciesArchive) || fs.statSync(dependenciesArchive).size === 0) {
    throw new Error(`CLINVEXA package is missing its offline dependency archive: ${dependenciesArchive}`)
  }
  for (const requiredWheel of [
    'voice-wheelhouse/faster_whisper-1.2.1-py3-none-any.whl',
    'voice-wheelhouse/ctranslate2-4.8.1-cp311-cp311-win_amd64.whl',
    'voice-wheelhouse/huggingface_hub-1.27.0-py3-none-any.whl',
    'voice-wheelhouse/filelock-3.32.2-py3-none-any.whl',
    'voice-wheelhouse/tokenizers-0.23.1-cp310-abi3-win_amd64.whl',
    'voice-wheelhouse/onnxruntime-1.28.0-cp311-cp311-win_amd64.whl'
  ]) {
    const wheelProbe = spawnSync('tar.exe', ['-tzf', dependenciesArchive, requiredWheel], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (wheelProbe.status !== 0) {
      throw new Error(`CLINVEXA offline dependency archive is missing ${requiredWheel}`)
    }
  }
  const runtimeExtrasArchive = path.join(
    context.appOutDir,
    'resources',
    'clinvexa-dependencies',
    'clinvexa-runtime-extras.tar'
  )
  if (!fs.existsSync(runtimeExtrasArchive) || fs.statSync(runtimeExtrasArchive).size === 0) {
    throw new Error(`CLINVEXA package is missing its runtime extras archive: ${runtimeExtrasArchive}`)
  }
  for (const requiredEntry of [
    'cua-driver/bin/cua-driver.exe',
    'faster-whisper/models--Systran--faster-whisper-medium/refs/main'
  ]) {
    const archiveProbe = spawnSync(
      'tar.exe',
      ['-tf', runtimeExtrasArchive, requiredEntry],
      { encoding: 'utf8', windowsHide: true }
    )
    if (archiveProbe.status !== 0) {
      throw new Error(
        `CLINVEXA offline dependency archive is missing ${requiredEntry}: ${
          archiveProbe.stderr || archiveProbe.error || 'unknown tar error'
        }`
      )
    }
  }
  console.log('[after-pack] verified bundled Chinese voice model and cua-driver')

  const liveVoiceRoot = path.join(context.appOutDir, 'resources', 'clinvexa-dependencies', 'clinvexa-live-voice')
  const liveVoiceManifest = path.join(liveVoiceRoot, 'manifest.json')
  if (!fs.existsSync(liveVoiceManifest)) {
    throw new Error(`CLINVEXA package is missing its live transcription engine: ${liveVoiceManifest}`)
  }
  const voiceFiles = JSON.parse(fs.readFileSync(liveVoiceManifest, 'utf8')).files
  if (!Array.isArray(voiceFiles) || voiceFiles.length < 80) {
    throw new Error('CLINVEXA package has an incomplete live transcription manifest')
  }
  for (const item of voiceFiles) {
    const relative = String(item.path || '')
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
      throw new Error(`CLINVEXA live transcription manifest has an unsafe path: ${relative}`)
    }
    const file = path.join(liveVoiceRoot, relative)
    if (!fs.existsSync(file) || fs.statSync(file).size !== Number(item.bytes)) {
      throw new Error(`CLINVEXA package has a missing or truncated voice resource: ${relative}`)
    }
  }
  console.log(`[after-pack] verified ${voiceFiles.length} live transcription resources`)

  const productName = context.packager?.appInfo?.productFilename || 'CLINVEXA'
  const exe = path.join(context.appOutDir, `${productName}.exe`)
  const desktopRoot = path.resolve(import.meta.dirname, '..')

  try {
    await stampExeIdentity(exe, desktopRoot, productName)
  } catch (err) {
    // Never fail the build over a cosmetic stamp.
    console.warn(`[after-pack] exe identity stamp failed (${err.message}); CLINVEXA.exe keeps the stock Electron icon`)
  }
}
