import { afterEach, expect, it, vi } from 'vitest'

import { rememberAssistantAdditions } from './assistant-recency'
const row = (id: string) => ({ id, name: id, description: '', source: 'local' as const })
afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks() })
it('remembers newly added entries across reloads without changing old timestamps on sync', () => {
  vi.spyOn(Date, 'now').mockReturnValue(100)
  expect(rememberAssistantAdditions('a', [row('old')])[0].addedAt).toBe(0)
  expect(rememberAssistantAdditions('a', [row('old'), row('new')])[1].addedAt).toBe(100)
  vi.spyOn(Date, 'now').mockReturnValue(200)
  expect(rememberAssistantAdditions('a', [row('new'), row('old')])[0].addedAt).toBe(100)
  expect(rememberAssistantAdditions('b', [row('new')])[0].addedAt).toBe(0)
})
