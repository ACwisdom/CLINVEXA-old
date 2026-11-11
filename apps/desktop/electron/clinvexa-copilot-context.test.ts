import { afterEach, expect, it, vi } from 'vitest'

import type { CopilotResult } from '../src/clinvexa/copilot/types'

import { createCopilotController } from './clinvexa-copilot'

afterEach(() => vi.useRealTimers())

it('coalesces voice updates and marks an older result stale until the newest context completes', async () => {
  vi.useFakeTimers()
  const finish: Array<(result: CopilotResult) => void> = []
  const analyze = vi.fn(() => new Promise<CopilotResult>(resolve => finish.push(resolve)))
  const controller = createCopilotController({ analyze, publish: vi.fn(), debounceMs: 10 })
  controller.setEnabled(true)
  controller.observe({ capturedAt: 1, observedAt: 1, latencyMs: 0, windowId: '1', title: 'Synthetic', processName: 'test', imageDataUrl: 'data:image/png;base64,fixture' })
  await vi.advanceTimersByTimeAsync(10)
  controller.refreshContext(); controller.refreshContext(); controller.refreshContext()
  expect(analyze).toHaveBeenCalledTimes(1)
  finish[0]({ id: 'old' } as CopilotResult)
  await vi.advanceTimersByTimeAsync(10)
  expect(controller.snapshot().result?.id).toBe('old')
  expect(controller.snapshot().stale).toBe(true)
  expect(analyze).toHaveBeenCalledTimes(2)
  finish[1]({ id: 'new' } as CopilotResult)
  await vi.advanceTimersByTimeAsync(1)
  expect(controller.snapshot().stale).toBe(false)
  expect(controller.snapshot().result?.id).toBe('new')
  controller.dispose()
})
