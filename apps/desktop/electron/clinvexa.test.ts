import { describe, expect, it, vi } from 'vitest'

import {
  CLINVEXABallBounds,
  createCLINVEXAScreenMonitor,
  type ForegroundWindowIdentity,
  parseForegroundWindowLine
} from './clinvexa'

describe('CLINVEXA screen monitor', () => {
  it('anchors the floating ball inside the active display work area', () => {
    expect(CLINVEXABallBounds({ height: 900, width: 1440, x: 1600, y: -200 })).toEqual({
      height: 72,
      width: 72,
      x: 2952,
      y: 612
    })
  })

  it('accepts only complete foreground-window events from the Windows watcher', () => {
    expect(parseForegroundWindowLine('{"windowId":"42","processName":"synthetic-his.exe","title":"门诊病历"}')).toEqual(
      { processName: 'synthetic-his.exe', title: '门诊病历', windowId: '42' }
    )
    expect(parseForegroundWindowLine('{"windowId":"","processName":"his.exe","title":"病历"}')).toBeNull()
    expect(parseForegroundWindowLine('not json')).toBeNull()
  })

  it('captures every changed foreground window and reports context within three seconds', async () => {
    let now = 0
    const captured: ForegroundWindowIdentity[] = []

    const monitor = createCLINVEXAScreenMonitor({
      capture: async identity => {
        now += 40
        captured.push(identity)

        return { imageDataUrl: `data:image/png;base64,${identity.windowId}` }
      },
      now: () => now
    })

    let correct = 0

    for (let index = 0; index < 200; index += 1) {
      now = index * 1_000

      const identity = {
        processName: 'synthetic-his.exe',
        title: `合成 HIS 窗口 ${index}`,
        windowId: String(index)
      }

      const context = await monitor.observe(identity)

      if (context?.windowId === identity.windowId && context.latencyMs <= 3_000) {
        correct += 1
      }
    }

    expect(correct).toBeGreaterThanOrEqual(196)
    expect(captured).toHaveLength(200)
    expect(monitor.snapshot().status).toBe('monitoring')
  })

  it('makes paused state visible and rejects captures immediately after pause', async () => {
    const capture = vi.fn(async () => ({ imageDataUrl: 'data:image/png;base64,synthetic' }))
    const monitor = createCLINVEXAScreenMonitor({ capture, now: () => 1_000 })

    await monitor.observe({ processName: 'his.exe', title: '患者列表', windowId: 'one' })
    monitor.pause()
    const context = await monitor.observe({ processName: 'his.exe', title: '病历首页', windowId: 'two' })

    expect(context).toBeNull()
    expect(capture).toHaveBeenCalledTimes(1)
    expect(monitor.snapshot().status).toBe('paused')
  })
})
