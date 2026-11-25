import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { notify } from '@/store/notifications'

import { $consultation } from './consultation/live-session'
import { $copilot } from './copilot/state'
import type { CopilotResult } from './copilot/types'
import { CLINVEXAHistorySidebar, copilotHistoryRows } from './history-sidebar'

vi.mock('@/app/routes', () => ({
  navigateToWorkspacePage: (navigate: (path: string) => void, path: string) => navigate(path)
}))
vi.mock('@/store/notifications', () => ({ notify: vi.fn() }))
vi.mock('./copilot/state', async original => ({ ...(await original<object>()), connectCopilot: () => () => {} }))

const result = (id: string, time: number, task = id) =>
  ({ id, taskKey: task, patientName: `合成病例${id}`, title: '', createdAt: time, revision: 0 }) as CopilotResult

const queryClients: QueryClient[] = []

function Location() {
  return (
    <output aria-label="当前页面">
      {useLocation().pathname}
      {useLocation().search}
    </output>
  )
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClients.push(client)

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CLINVEXAHistorySidebar />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  $copilot.set({ ...$copilot.get(), result: null })
  $consultation.set({ status: 'setup', record: null, draft: '', elapsed: 0, pending: 0, error: null, dirty: false })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { CLINVEXACopilot: { history: vi.fn().mockResolvedValue([result('旧', 1000)]) } }
  })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json([
          { id: 'voice-1', patient_name: '合成问诊', started_at: '2026-09-30T09:00:00+08:00', status: 'ready' }
        ])
      )
  )
})
afterEach(() => {
  cleanup()
  queryClients.splice(0).forEach(client => client.clear())
  vi.unstubAllGlobals()
})

it('groups existing records and opens the exact saved record without starting a new task', async () => {
  mount()
  const visual = await screen.findByRole('region', { name: '视觉副驾驶历史记录' })
  fireEvent.click(await within(visual).findByRole('button', { name: /合成病例旧/ }))
  expect(screen.getByLabelText('当前页面').textContent).toBe('/clinvexa-copilot?record=%E6%97%A7&task=%E6%97%A7')
  fireEvent.click(await screen.findByRole('button', { name: /合成问诊/ }))
  expect(screen.getByLabelText('当前页面').textContent).toBe('/clinvexa-consultation?record=voice-1')
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
})

it('adds new visual results immediately and keeps earlier results when another arrives', async () => {
  mount()
  await screen.findByRole('button', { name: /合成病例旧/ })
  act(() => $copilot.set({ ...$copilot.get(), result: result('新一', 2000) }))
  await screen.findByRole('button', { name: /合成病例新一/ })
  act(() => $copilot.set({ ...$copilot.get(), result: result('新二', 3000) }))
  await screen.findByRole('button', { name: /合成病例新二/ })
  expect(screen.getByRole('button', { name: /合成病例新一/ })).toBeTruthy()
})

it('protects unsaved consultation drafts instead of navigating to another record', async () => {
  $consultation.set({ ...$consultation.get(), dirty: true })
  mount()
  fireEvent.click(await screen.findByRole('button', { name: /合成问诊/ }))
  expect(screen.getByLabelText('当前页面').textContent).toBe('/')
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: '暂时不能切换问诊' }))
})

it('shows an explicit retry state when history fails', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('offline'))
  mount()
  await waitFor(() =>
    expect(within(screen.getByRole('region', { name: '问诊记录历史记录' })).getByRole('status').textContent).toContain(
      '记录暂未同步'
    )
  )
  expect(screen.getByRole('button', { name: '刷新问诊记录' })).toBeTruthy()
})

it('deduplicates a visual task to its newest result', () => {
  expect(
    copilotHistoryRows([result('旧', 1000, 'task'), result('新', 3000, 'task'), result('另一条', 2000)]).map(
      row => row.id
    )
  ).toEqual(['新', '另一条'])
})
