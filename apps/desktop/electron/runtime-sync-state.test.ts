import assert from 'node:assert/strict'

import { test } from 'vitest'

import { runtimeSyncRequired } from './runtime-sync-state'

test('a packaged runtime synchronizes when the build fingerprint changes', () => {
  assert.equal(
    runtimeSyncRequired({
      activeComplete: true,
      currentFingerprint: 'old-build',
      expectedFingerprint: 'new-build',
      isPackaged: true,
      sameRoot: false,
      sourceComplete: true
    }),
    true
  )
})

test('an unchanged complete runtime skips the expensive copy', () => {
  assert.equal(
    runtimeSyncRequired({
      activeComplete: true,
      currentFingerprint: 'same-build',
      expectedFingerprint: 'same-build',
      isPackaged: true,
      sameRoot: false,
      sourceComplete: true
    }),
    false
  )
})

test('an incomplete active runtime is repaired even when the marker matches', () => {
  assert.equal(
    runtimeSyncRequired({
      activeComplete: false,
      currentFingerprint: 'same-build',
      expectedFingerprint: 'same-build',
      isPackaged: true,
      sameRoot: false,
      sourceComplete: true
    }),
    true
  )
})
