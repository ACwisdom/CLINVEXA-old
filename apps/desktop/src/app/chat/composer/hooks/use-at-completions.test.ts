import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { hermesDirectiveFormatter } from '@/components/assistant-ui/directive-text'
import { queryClient } from '@/lib/query-client'

import { useAtCompletions } from './use-at-completions'

function gatewayStub(latencyMs = 40) {
  const calls: string[] = []

  const gateway = {
    request: vi.fn(async (_method: string, params: { word: string }) => {
      calls.push(params.word)
      await new Promise(r => setTimeout(r, latencyMs))

      return { items: [{ text: `@folder:${params.word.slice(1)}x/`, display: 'x/', meta: 'dir' }] }
    })
  }

  return { calls, gateway }
}

function setup(latencyMs = 40) {
  const { calls, gateway } = gatewayStub(latencyMs)

  const { result } = renderHook(() => useAtCompletions({ gateway: gateway as never, sessionId: 's1', cwd: '/repo' }))

  return { calls, result }
}

/** Type a burst of keystrokes `gapMs` apart, like a person. */
async function type(
  result: { current: { adapter: { search?: (q: string) => unknown } } },
  queries: string[],
  gapMs: number
) {
  for (const q of queries) {
    act(() => {
      result.current.adapter.search?.(q)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(gapMs)
    })
  }
}

describe('PERF: @ path completions are cached and skip the debounce', () => {
  it('serves a repeated query with no round trip and no spinner', async () => {
    vi.useFakeTimers()
    queryClient.clear()

    const { calls, result } = setup()

    // First visit to `apps/` pays the round trip.
    await type(result, ['apps/'], 0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    const afterFirst = calls.length

    expect(afterFirst).toBe(1)

    // Walk away and come back — Tab in, Backspace out, retype. Every one of
    // these used to be a fresh git ls-files + rank on the backend.
    await type(result, ['apps/desktop/', 'apps/', 'apps/desktop/', 'apps/'], 0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // Two distinct paths, so exactly two round trips total — the repeats are free.
    expect(calls.length).toBe(2)
    expect(result.current.loading).toBe(false)

    vi.useRealTimers()
  })

  it('a cached query paints without waiting out the debounce', async () => {
    vi.useFakeTimers()
    queryClient.clear()

    const { calls, result } = setup()

    await type(result, ['apps/'], 0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(calls.length).toBe(1)

    // Re-ask for the cached query and advance by far less than the 60ms
    // debounce. A cached answer resolves in a microtask, so it must paint
    // without the timer and without ever flipping the spinner on.
    act(() => {
      result.current.adapter.search?.('apps/')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(result.current.loading).toBe(false)
    expect(calls.length).toBe(1)

    vi.useRealTimers()
  })
})

it('offers skills and account agents immediately with executable mention text while retaining reference browsing', () => {
  const { result } = renderHook(() =>
    useAtCompletions({
      gateway: null,
      sessionId: 'existing',
      cwd: null,
      assistants: [
        { id: 'record-structuring', name: '病历结构化', description: '整理资料', source: 'local' },
        { id: 'meeting', name: '会议助手', description: '会议纪要', source: 'platform', account: 'owner' }
      ]
    })
  )

  const rows = (result.current.adapter.search?.('病历') ?? []).filter(row => row.id.startsWith('assistant:'))
  expect(rows).toHaveLength(1)
  expect(rows[0].label).toBe('@病历结构化')
  expect(hermesDirectiveFormatter.serialize(rows[0])).toBe('@病历结构化')
  expect(result.current.adapter.search?.('record')?.find(row => row.id.startsWith('assistant:'))?.label).toBe('@病历结构化')
  expect(result.current.adapter.search?.('会议')?.find(row => row.id.startsWith('assistant:'))?.label).toBe('@会议助手')
  expect(result.current.adapter.search?.('file:')).toEqual([])
})

it('shows agents before skills, four newest per group, and expands without offering a same-named file', () => {
  const assistants = ['local', 'platform'].flatMap(source => Array.from({ length: 6 }, (_, i) => ({
    id: `${source}-${i}`, name: `${source}助手${i}`, source: source as 'local' | 'platform', description: '', addedAt: i
  })))

  const request = vi.fn()
  const { result } = renderHook(() => useAtCompletions({ gateway: { request } as never, sessionId: 's', cwd: null, assistants }))
  let rows = result.current.adapter.search?.('') ?? []
  expect(rows.map(row => row.id)).toEqual([
    'assistant:platform:platform-5', 'assistant:platform:platform-4', 'assistant:platform:platform-3', 'assistant:platform:platform-2', 'expand:platform',
    'assistant:local:local-5', 'assistant:local:local-4', 'assistant:local:local-3', 'assistant:local:local-2', 'expand:local'
  ])
  act(() => { result.current.pickControl(rows[4]) })
  rows = result.current.adapter.search?.('') ?? []
  expect(rows.filter(row => row.id.startsWith('assistant:platform:'))).toHaveLength(6)
  expect(rows.filter(row => row.id.startsWith('assistant:local:'))).toHaveLength(4)
  expect(result.current.adapter.search?.('local助手0')?.some(row => row.id === 'assistant:local:local-0')).toBe(true)
  expect(request).not.toHaveBeenCalled()
  act(() => { result.current.reset() })
  expect(result.current.adapter.search?.('')?.filter(row => row.id.startsWith('assistant:'))).toHaveLength(8)
})
