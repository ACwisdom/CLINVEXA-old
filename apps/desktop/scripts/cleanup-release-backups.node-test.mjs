import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cleanupReleaseBackups } from './cleanup-release-backups.mjs'

test('cleanupReleaseBackups removes only obsolete unpacked software backups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinvexa-release-cleanup-'))
  try {
    fs.mkdirSync(path.join(root, 'win-unpacked.bak'))
    fs.writeFileSync(path.join(root, 'win-unpacked.bak', 'CLINVEXA.exe'), 'old')
    fs.mkdirSync(path.join(root, 'win-unpacked'))
    fs.writeFileSync(path.join(root, 'win-unpacked', 'CLINVEXA.exe'), 'current')
    fs.mkdirSync(path.join(root, 'keep-me'))

    const removed = cleanupReleaseBackups(root)

    assert.deepEqual(removed, [path.join(root, 'win-unpacked.bak')])
    assert.equal(fs.existsSync(path.join(root, 'win-unpacked.bak')), false)
    assert.equal(fs.existsSync(path.join(root, 'win-unpacked', 'CLINVEXA.exe')), true)
    assert.equal(fs.existsSync(path.join(root, 'keep-me')), true)
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})
