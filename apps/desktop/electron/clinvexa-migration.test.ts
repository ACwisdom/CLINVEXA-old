import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { migratePreviousBrandData } from './clinvexa-migration'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

it('carries clinical state into the renamed profile without copying the old engine', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clinvexa-migrate-'))
  roots.push(base)
  const previous = path.join(base, ['Doctor', 'Claw'].join(''))
  const previousRuntime = path.join(previous, 'runtime')
  fs.mkdirSync(path.join(previousRuntime, 'sessions'), { recursive: true })
  fs.mkdirSync(path.join(previousRuntime, 'hermes-agent'), { recursive: true })
  fs.mkdirSync(path.join(previousRuntime, ['Doctor', 'Claw'].join('').toLowerCase()), { recursive: true })
  fs.writeFileSync(path.join(previousRuntime, 'config.yaml'), 'model: demo')
  fs.writeFileSync(path.join(previousRuntime, 'sessions', 'visit.json'), '{"visit":1}')
  fs.writeFileSync(path.join(previousRuntime, 'hermes-agent', 'python.exe'), 'old')
  fs.writeFileSync(path.join(previousRuntime, ['Doctor', 'Claw'].join('').toLowerCase(), 'old.py'), 'old')
  const next = path.join(base, 'CLINVEXA')
  migratePreviousBrandData(base, next)
  expect(fs.readFileSync(path.join(next, 'runtime', 'config.yaml'), 'utf8')).toBe('model: demo')
  expect(fs.readFileSync(path.join(next, 'runtime', 'sessions', 'visit.json'), 'utf8')).toBe('{"visit":1}')
  expect(fs.existsSync(path.join(next, 'runtime', 'hermes-agent'))).toBe(false)
  expect(fs.existsSync(path.join(next, 'runtime', 'clinvexa'))).toBe(false)
  fs.writeFileSync(path.join(next, 'runtime', 'config.yaml'), 'model: keep')
  migratePreviousBrandData(base, next)
  expect(fs.readFileSync(path.join(next, 'runtime', 'config.yaml'), 'utf8')).toBe('model: keep')
})
