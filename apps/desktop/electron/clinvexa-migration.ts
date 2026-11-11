import fs from 'node:fs'
import path from 'node:path'

// Preserve settings and clinical work from the prior product installation.
// Runtime engines are installed anew from the bundled offline dependencies.
const PREVIOUS_APP_DIRECTORY = ['Doctor', 'Claw'].join('')
const STATE_DIRECTORIES = [
  'audio_cache', 'cron', 'desktop', 'desktop-plugins', 'hooks', 'memories',
  'pairing', 'pets', 'sandboxes', 'sessions', 'skills'
]
const BROWSER_DIRECTORIES = ['Local Storage', 'Network', 'Partitions', 'Session Storage']

function copyIfAbsent(source: string, destination: string): boolean {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return false
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true })
    return true
  } catch {
    // Another process may still hold a database or browser file. Leave the
    // source intact and retry on the next launch.
    return false
  }
}

export function migratePreviousBrandData(appDataDir: string, newUserData: string): void {
  const oldUserData = path.join(appDataDir, PREVIOUS_APP_DIRECTORY)
  if (path.resolve(oldUserData).toLowerCase() === path.resolve(newUserData).toLowerCase()) return
  if (!fs.existsSync(oldUserData)) return
  const oldRuntime = path.join(oldUserData, 'runtime')
  const newRuntime = path.join(newUserData, 'runtime')
  fs.mkdirSync(newUserData, { recursive: true })
  fs.mkdirSync(newRuntime, { recursive: true })

  for (const entry of fs.readdirSync(oldUserData, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (entry.isFile() && (entry.name.endsWith('.json') || ['Preferences', 'Local State'].includes(entry.name))) {
      copyIfAbsent(path.join(oldUserData, entry.name), path.join(newUserData, entry.name))
    } else if (entry.isDirectory() && BROWSER_DIRECTORIES.includes(entry.name)) {
      copyIfAbsent(path.join(oldUserData, entry.name), path.join(newUserData, entry.name))
    }
  }

  if (!fs.existsSync(oldRuntime)) return
  for (const entry of fs.readdirSync(oldRuntime, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (entry.isFile() && (entry.name.startsWith('.') || /\.(json|ya?ml|db|db-shm|db-wal)$/i.test(entry.name))) {
      copyIfAbsent(path.join(oldRuntime, entry.name), path.join(newRuntime, entry.name))
    } else if (entry.isDirectory() && STATE_DIRECTORIES.includes(entry.name)) {
      copyIfAbsent(path.join(oldRuntime, entry.name), path.join(newRuntime, entry.name))
    }
  }
  const oldSkillRoot = path.join(newRuntime, 'skills', PREVIOUS_APP_DIRECTORY.toLowerCase())
  const newSkillRoot = path.join(newRuntime, 'skills', 'clinvexa')
  if (fs.existsSync(oldSkillRoot) && !fs.existsSync(newSkillRoot)) {
    try { fs.renameSync(oldSkillRoot, newSkillRoot) } catch { /* Retain copied skills for retry. */ }
  }
}
