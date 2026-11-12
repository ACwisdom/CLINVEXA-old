import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $summonedAssistants, bindAssistant, type SummonedAssistant } from './summon'
import { useSummonedSubmit } from './use-summoned-submit'
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

const assistant: SummonedAssistant = {
  id: 'installed',
  name: '会议助手',
  description: '',
  source: 'platform',
  account: 'origin|owner'
}

afterEach(() => {
  cleanup()
  $summonedAssistants.set({})
  vi.unstubAllGlobals()
})
it('sends verified instructions and real task through the main chat callback', async () => {
  bindAssistant(assistant, ['session'])
  vi.stubGlobal('hermesDesktop', { api: vi.fn(async () => ({ invocation: '会议助手专属说明\n整理今天的会议' })) })
  const send = vi.fn(async () => true)
  const { result } = renderHook(() => useSummonedSubmit('session', 'session', true))
  await act(async () => {
    expect(await result.current.submit(send, '整理今天的会议')).toBe(true)
  })
  expect(send).toHaveBeenCalledWith(
    '会议助手专属说明\n整理今天的会议',
    expect.objectContaining({ sessionId: 'session', displayText: '@会议助手\n整理今天的会议' })
  )
})
it('rejects loading failure without calling the ordinary send callback', async () => {
  bindAssistant(assistant, ['session'])
  vi.stubGlobal('hermesDesktop', {
    api: vi.fn(async () => {
      throw new Error('expired')
    })
  })
  const send = vi.fn(async () => true)
  const { result } = renderHook(() => useSummonedSubmit('session', 'session', true))
  await act(async () => {
    expect(await result.current.submit(send, '保留这段输入')).toBe(false)
  })
  expect(send).not.toHaveBeenCalled()
})
it('does not retarget a delayed capability load when the user switches conversation', async () => {
  bindAssistant(assistant, ['session'])
  let resolve!: (value: { invocation: string }) => void
  vi.stubGlobal('hermesDesktop', {
    api: vi.fn(
      () =>
        new Promise(r => {
          resolve = r
        })
    )
  })
  const send = vi.fn(async () => true)

  const { result, rerender } = renderHook(({ id }) => useSummonedSubmit(id, id, true), {
    initialProps: { id: 'session' }
  })

  let pending!: Promise<boolean>
  act(() => {
    pending = result.current.submit(send, '任务')
  })
  rerender({ id: 'another' })
  await act(async () => {
    resolve({ invocation: 'ready' })
    expect(await pending).toBe(false)
  })
  expect(send).not.toHaveBeenCalled()
})
it('preserves other conversations, tile composers and native slash commands', async () => {
  bindAssistant(assistant, ['session'])
  const send = vi.fn(async () => true)
  const { result } = renderHook(() => useSummonedSubmit('session', 'session', false))
  await act(async () => {
    await result.current.submit(send, '普通任务')
  })
  expect(send).toHaveBeenCalledWith('普通任务', undefined)
  const main = renderHook(() => useSummonedSubmit('session', 'session', true))
  await act(async () => {
    await main.result.current.submit(send, '/model')
  })
  expect(send).toHaveBeenLastCalledWith('/model', undefined)
})

it('calls a typed skill in the existing session, preserves attachments and replaces the previous helper', async () => {
  const local: SummonedAssistant = { id: 'record-structuring', name: '病历结构化', source: 'local', description: '' }
  bindAssistant(assistant, ['session', 'stored'])
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ invocation: '真实技能说明\n整理上文附件' })))
  vi.stubGlobal('fetch', fetchMock)
  const send = vi.fn(async () => true)
  const { result } = renderHook(() => useSummonedSubmit('session', 'stored', true, [local]))
  const options = { attachments: [{ id: 'report', kind: 'file' as const, label: 'report.txt' }], composerScope: 'stored' }
  await act(async () => {
    expect(await result.current.submit(send, '@病历结构化 整理上文附件', options)).toBe(true)
  })
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/record-structuring/prepare'),
    expect.objectContaining({ body: JSON.stringify({ task: '整理上文附件', source_paths: [] }) })
  )
  expect(send).toHaveBeenCalledWith('真实技能说明\n整理上文附件', {
    ...options,
    sessionId: 'session',
    displayText: '@病历结构化\n整理上文附件'
  })
  expect($summonedAssistants.get().stored).toBe(local)
  expect($summonedAssistants.get().session).toBe(local)
})

it('does not send an unresolved mention or bind a helper after a rejected send', async () => {
  const send = vi.fn(async () => false)
  vi.stubGlobal('hermesDesktop', { api: vi.fn(async () => ({ invocation: 'verified' })) })
  const { result } = renderHook(() => useSummonedSubmit('session', 'stored', true, [assistant]))
  await act(async () => {
    expect(await result.current.submit(send, '@不存在 任务')).toBe(false)
  })
  expect(send).not.toHaveBeenCalled()
  await act(async () => {
    expect(await result.current.submit(send, '@会议助手 任务')).toBe(false)
  })
  expect($summonedAssistants.get()).toEqual({})
})

it('cancels a mention load across a session switch even when neither session has a binding', async () => {
  let resolve!: (value: { invocation: string }) => void
  vi.stubGlobal('hermesDesktop', {
    api: vi.fn(
      () =>
        new Promise(r => {
          resolve = r
        })
    )
  })
  const send = vi.fn(async () => true)

  const { result, rerender } = renderHook(({ id }) => useSummonedSubmit(id, id, true, [assistant]), {
    initialProps: { id: 'session' }
  })

  let pending!: Promise<boolean>
  act(() => {
    pending = result.current.submit(send, '@会议助手 任务')
  })
  rerender({ id: 'another' })
  await act(async () => {
    resolve({ invocation: 'verified' })
    expect(await pending).toBe(false)
  })
  expect(send).not.toHaveBeenCalled()
  expect($summonedAssistants.get()).toEqual({})
})
