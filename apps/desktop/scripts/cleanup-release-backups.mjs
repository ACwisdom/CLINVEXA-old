import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Remove only direct `*-unpacked.bak` build artifacts after a successful build. */
export function cleanupReleaseBackups(releaseDir) {
  const root = path.resolve(releaseDir)

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return []
  }

  const removed = []

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('-unpacked.bak')) {
      continue
    }

    const target = path.resolve(root, entry.name)
    if (path.dirname(target) !== root) {
      throw new Error(`Refusing to remove a rollback backup outside the release directory: ${target}`)
    }

    fs.rmSync(target, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
    removed.push(target)
  }

  return removed
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (invokedPath === fileURLToPath(import.meta.url)) {
  const releaseDir = process.argv[2]
  if (!releaseDir) {
    throw new Error('Usage: node cleanup-release-backups.mjs <release-directory>')
  }

  for (const removed of cleanupReleaseBackups(releaseDir)) {
    console.log(`[cleanup-release-backups] removed obsolete software backup: ${removed}`)
  }
}
