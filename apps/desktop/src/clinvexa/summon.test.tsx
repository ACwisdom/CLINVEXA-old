import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $summonedAssistants, bindAssistant, prepareAssistant, type SummonedAssistant } from './summon'
import { SummonChip } from './summon-chip'

const assistant: SummonedAssistant = {
  id: 'example',
  source: 'platform',
  account: 'origin|owner',
  name: '会议助手',
  description: '整理会议'
}

afterEach(() => {
  cleanup()
  $summonedAssistants.set({})
  vi.unstubAllGlobals()
})
it('binds only to the summoned conversation and removes all of its aliases', () => {
  bindAssistant(assistant, ['runtime', 'stored'])
  expect($summonedAssistants.get().unrelated).toBeUndefined()
  render(<SummonChip assistant={assistant} preparing={false} />)
  fireEvent.click(screen.getByRole('button', { name: '移除 会议助手' }))
  expect($summonedAssistants.get()).toEqual({})
})
it('prepares the selected platform installation with the bound identity and actual task', async () => {
  const api = vi.fn(async () => ({ invocation: 'verified instructions\nuser task' }))
  vi.stubGlobal('hermesDesktop', { api })
  expect(await prepareAssistant(assistant, 'user task')).toContain('verified instructions')
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/clinvexa/platform/prepare',
      body: { installation_id: 'example', account_id: 'origin|owner', text: 'user task' }
    })
  )
})
it('rejects expired platform authorization instead of falling back to generic chat', async () => {
  vi.stubGlobal('hermesDesktop', {
    api: vi.fn(async () => {
      throw new Error('授权失效')
    })
  })
  await expect(prepareAssistant(assistant, 'task')).rejects.toThrow('授权失效')
})
it('rechecks local skill installation and preserves the user task', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ invocation: '$weekly\n原始任务' })))
  vi.stubGlobal('fetch', fetchMock)
  expect(await prepareAssistant({ ...assistant, id: 'weekly', source: 'local' }, '原始任务')).toContain('原始任务')
  expect(fetchMock).toHaveBeenCalledWith(
    'http://127.0.0.1:8001/clinvexa/skills/weekly/prepare',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ task: '原始任务', source_paths: [] }) })
  )
})
