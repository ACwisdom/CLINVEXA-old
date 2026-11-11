import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { test } from 'vitest'

import {
  FALLBACK_BRANCH,
  FALLBACK_COMMIT,
  contentIdentity,
  fromCI,
  fromFallback,
  fromLocalGit,
  isFallbackCommit,
  resolveStamp
} from './write-build-stamp.mjs'

test('fromCI reads GITHUB_SHA / GITHUB_REF_NAME', () => {
  assert.deepEqual(
    fromCI({ GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'release' }),
    { commit: 'a'.repeat(40), branch: 'release', dirty: false, source: 'ci' }
  )
  assert.equal(fromCI({}), null)
})

test('fromLocalGit returns null when git rev-parse fails', () => {
  const stamp = fromLocalGit('/tmp/not-a-repo', () => null)
  assert.equal(stamp, null)
})

test('fromLocalGit reads HEAD + branch + dirty status', () => {
  const calls = []
  const execFn = (cmd) => {
    calls.push(cmd)
    if (cmd === 'git rev-parse HEAD') return 'b'.repeat(40)
    if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main'
    if (cmd === 'git status --porcelain -uno') return ' M apps/desktop/package.json'
    return null
  }
  assert.deepEqual(fromLocalGit('/repo', execFn), {
    commit: 'b'.repeat(40),
    branch: 'main',
    dirty: true,
    source: 'local'
  })
  assert.ok(calls.includes('git rev-parse HEAD'))
})

function fixtureSource() {
  const root = mkdtempSync(join(tmpdir(), 'clinvexa-stamp-'))
  mkdirSync(join(root, 'clinvexa'), { recursive: true })
  writeFileSync(join(root, 'pyproject.toml'), '[project]\nname="clinvexa"\n')
  writeFileSync(join(root, 'clinvexa', 'main.py'), 'print("CLINVEXA")\n')
  return root
}

test('fromFallback uses a deterministic non-zero content identity', () => {
  const root = fixtureSource()
  const identity = contentIdentity(root)
  assert.deepEqual(fromFallback(FALLBACK_BRANCH, root), {
    commit: identity,
    branch: FALLBACK_BRANCH,
    dirty: false,
    source: 'content-hash'
  })
  assert.match(identity, /^[0-9a-f]{40}$/)
  assert.notEqual(identity, FALLBACK_COMMIT)
  assert.equal(isFallbackCommit(FALLBACK_COMMIT), true)
  assert.equal(isFallbackCommit(identity), false)
})

test('resolveStamp prefers CI over local git over fallback', () => {
  const ci = resolveStamp({
    env: { GITHUB_SHA: 'c'.repeat(40), GITHUB_REF_NAME: 'main' },
    execFn: () => 'should-not-run'
  })
  assert.equal(ci.source, 'ci')
  assert.equal(ci.commit, 'c'.repeat(40))

  const local = resolveStamp({
    env: {},
    execFn: (cmd) => {
      if (cmd === 'git rev-parse HEAD') return 'd'.repeat(40)
      if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main'
      if (cmd === 'git status --porcelain -uno') return ''
      return null
    }
  })
  assert.equal(local.source, 'local')
  assert.equal(local.commit, 'd'.repeat(40))
  assert.equal(local.dirty, false)
})

test('resolveStamp falls back when neither CI nor git is available', () => {
  const root = fixtureSource()
  const stamp = resolveStamp({ env: {}, execFn: () => null, repoRoot: root })
  assert.deepEqual(stamp, {
    commit: contentIdentity(root),
    branch: FALLBACK_BRANCH,
    dirty: false,
    source: 'content-hash'
  })
})
