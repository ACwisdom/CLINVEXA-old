import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CopilotResult } from '../src/clinvexa/copilot/types'

import { CLINVEXAFrameChanged, CLINVEXAPanelBounds, createCLINVEXAScreenMonitor } from './clinvexa'
import { createCopilotController, selectedSuggestions, withQuickFillClipboardFallback } from './clinvexa-copilot'

const frame = (windowId = '100', image = 'one') => ({ windowId, title: '合成 HIS', processName: 'his', capturedAt: 100, observedAt: 80, latencyMs: 20, imageDataUrl: image })
const result = (id = 'A') => ({ id, suggestions: [{ id: 's1', text: 'one' }, { id: 's2', text: 'two' }, { id: 's3', text: 'three' }] }) as CopilotResult

const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r});

 return { promise, resolve }}

afterEach(() => vi.useRealTimers())

describe('visual copilot scheduling and patient boundaries', () => {
  it('passes the selected recognition only with an explicit follow-up', async () => {
    vi.useFakeTimers()
    const analyze = vi.fn().mockResolvedValue(result())
    const controller = createCopilotController({analyze, publish:vi.fn(), debounceMs:10})
    controller.setEnabled(true)
    controller.observe(frame())
    const currentFrame = controller.snapshot().frameId!
    controller.request('整理图片中的名称', '', currentFrame, 'saved-result')
    await vi.advanceTimersByTimeAsync(10)
    expect(analyze.mock.calls[0][1]).toBe('整理图片中的名称')
    expect(analyze.mock.calls[0][5]).toBe('saved-result')
    controller.dispose()
  })
  it('counts activation, window capture and analysis in the displayed delivery time', async () => {
    vi.useFakeTimers()
    let now = 1000
    const controller = createCopilotController({analyze:vi.fn().mockResolvedValue(result()),publish:vi.fn(),now:()=>now,debounceMs:10})
    controller.setEnabled(true)
    now = 5000
    controller.observe({...frame(),observedAt:2000,capturedAt:5000})
    now = 9000
    await vi.advanceTimersByTimeAsync(10)
    expect(controller.snapshot().result?.deliveryMs).toBe(8000)
    controller.dispose()
  })
  it('bounds analysis even when a provider never settles, and rejects a stale manual context', async () => {
    vi.useFakeTimers()
    const analyze = vi.fn().mockReturnValue(new Promise(() => {}))
    const controller = createCopilotController({analyze, publish: vi.fn(), debounceMs: 10})
    controller.setEnabled(true); controller.observe(frame())
    const old = controller.snapshot().frameId!
    controller.observe(frame('next'))
    expect(() => controller.request('question', 'old material', old)).toThrow('画面已变化')
    await vi.advanceTimersByTimeAsync(30020)
    expect(controller.snapshot().status).toBe('error')
    expect(controller.snapshot().error).toContain('30 秒')
    expect(analyze.mock.calls[0][3].aborted).toBe(true)
    controller.dispose()
  })
  it('starts reading within four seconds despite continuous visual changes', async () => {
    vi.useFakeTimers()
    const analyze = vi.fn().mockResolvedValue(result())
    const controller = createCopilotController({analyze, publish: vi.fn()})
    controller.setEnabled(true)

    for (let i = 0; i < 6; i++) {controller.observe(frame(String(i))); await vi.advanceTimersByTimeAsync(800)}
    expect(analyze.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(analyze.mock.calls.length).toBeLessThanOrEqual(6)
    expect(controller.snapshot().target).not.toHaveProperty('imageDataUrl')
    controller.dispose()
  })
  it('captures changes within an unchanged title but never republishes identical frames', async () => {
    let image = 'one'
    const publish = vi.fn()
    const monitor = createCLINVEXAScreenMonitor({ capture: async () => ({ imageDataUrl: image }), onState: publish })
    await monitor.observe(frame())
    const count = publish.mock.calls.length
    await monitor.observe(frame())
    expect(publish).toHaveBeenCalledTimes(count)
    image = 'changed patient banner'
    await monitor.observe(frame())
    expect(monitor.snapshot().context?.imageDataUrl).toBe(image)
    expect(publish).toHaveBeenCalledTimes(count + 1)
  })

  it('drops a capture and a capture error that complete after pause', async () => {
    const captured = deferred<{ imageDataUrl: string }>()
    const monitor = createCLINVEXAScreenMonitor({ capture: () => captured.promise })
    const pending = monitor.observe(frame())
    monitor.pause()
    captured.resolve({ imageDataUrl: 'late' })
    expect(await pending).toBeNull()
    expect(monitor.snapshot().status).toBe('paused')
    monitor.resume()
    expect(monitor.snapshot().context).toBeNull()
  })

  it('rejects old patient results and analyzes only the latest queued frame', async () => {
    vi.useFakeTimers()
    const pending = deferred<CopilotResult>()
    const analyze = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(result('C'))
    const controller = createCopilotController({ analyze, publish: vi.fn(), debounceMs: 100 })
    controller.setEnabled(true)
    controller.observe(frame('A'))
    await vi.advanceTimersByTimeAsync(100)
    controller.observe(frame('B'))
    controller.observe(frame('C'))
    await vi.advanceTimersByTimeAsync(100)
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze.mock.calls[0][3].aborted).toBe(true)
    // Latest patient starts without waiting for an obsolete provider response.
    await vi.advanceTimersByTimeAsync(100)
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(controller.snapshot().result?.id).toBe('C')
    pending.resolve(result('A'))
    await vi.advanceTimersByTimeAsync(1)
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(analyze.mock.calls[1][0].windowId).toBe('C')
    expect(controller.snapshot().result?.id).toBe('C')
    controller.dispose()
  })

  it('pause/resume never reuses a screen captured before pause', async () => {
    vi.useFakeTimers()
    const analyze = vi.fn().mockResolvedValue(result())
    const controller = createCopilotController({ analyze, publish: vi.fn(), debounceMs: 100 })
    controller.setEnabled(true); controller.observe(frame()); controller.setEnabled(false); controller.setEnabled(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(analyze).not.toHaveBeenCalled()
    expect(controller.latestFrame()).toBeNull()
    controller.dispose()
  })

  it('keeps the source result while following a different HIS target in fill mode', async () => {
    vi.useFakeTimers()
    const sourceResult = { ...result('source'), frameId:'source-frame', windowId:'source-window', title:'病历资料' } as CopilotResult
    const analyze = vi.fn().mockResolvedValue(sourceResult)
    const controller = createCopilotController({ analyze, publish: vi.fn(), debounceMs: 10 })
    controller.setEnabled(true)
    controller.startFillMode(sourceResult)
    controller.observe({ ...frame('his-window'), title:'模拟 HIS 门诊复诊' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(analyze).not.toHaveBeenCalled()
    expect(controller.snapshot().result?.id).toBe('source')
    expect(controller.snapshot().fillMode).toBe(true)
    expect(controller.snapshot().stale).toBe(false)
    expect(controller.snapshot().target?.title).toBe('模拟 HIS 门诊复诊')
    controller.dispose()
  })

  it('repeated failures stop automatic requests and leave explicit retry available', async () => {
    vi.useFakeTimers()
    const analyze = vi.fn().mockRejectedValue(new Error('offline'))
    const controller = createCopilotController({ analyze, publish: vi.fn(), debounceMs: 10 })
    controller.setEnabled(true)

    for (let i = 0; i < 8; i++) {controller.observe(frame(String(i))); await vi.advanceTimersByTimeAsync(20)}
    expect(analyze).toHaveBeenCalledTimes(3)
    controller.request()
    await vi.advanceTimersByTimeAsync(20)
    expect(analyze).toHaveBeenCalledTimes(4)
    expect(controller.snapshot().status).toBe('error')
    controller.dispose()
  })

  it('selects precisely two requested suggestions and rejects a changed version', () => {
    expect(selectedSuggestions(result(), 'A', ['s1', 's3']).map(item => item.text)).toEqual(['one', 'three'])
    expect(() => selectedSuggestions(result('B'), 'A', ['s1'])).toThrow()
    expect(() => selectedSuggestions(result(), 'A', ['missing'])).toThrow()
  })

  it('allows all 25 suggestions for copy/fill and rejects a 26-item selection', () => {
    const expanded = {
      ...result(),
      suggestions: Array.from({ length: 26 }, (_, index) => ({ ...result().suggestions[0], id: `s${index}`, text: `field ${index}` }))
    }

    const ids = expanded.suggestions.map(item => item.id)
    expect(selectedSuggestions(expanded, 'A', ids.slice(0, 25))).toEqual(expanded.suggestions.slice(0, 25))
    expect(() => selectedSuggestions(expanded, 'A', ids)).toThrow('请重新选择当前结果')
  })

  it('copies the selected field when native quick fill cannot locate a browser control', () => {
    const write = vi.fn()
    const selected = [{id:'s1',kind:'field',title:'主诉',text:'咳嗽 3 天',reason:'',evidence:[],sourceIds:[],cautions:[],targetLabel:'主诉'}] as CopilotResult['suggestions']
    const response = withQuickFillClipboardFallback({status:'failed',message:'无法唯一定位字段：主诉',fields:[]}, selected, write)
    expect(write).toHaveBeenCalledWith('咳嗽 3 天')
    expect(response.status).toBe('copied')
    expect(response.message).toContain('Ctrl+V')
  })

  it('keeps expanded and collapsed panels inside secondary monitor coordinates', () => {
    const area = { x: -1920, y: -200, width: 1920, height: 1080 }
    const anchor = { x: -80, y: 810, width: 72, height: 72 }
    const bounds = CLINVEXAPanelBounds(anchor, area, true)
    expect(bounds.x).toBeGreaterThanOrEqual(area.x)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(880)
    expect(CLINVEXAPanelBounds(bounds, area, false).width).toBe(72)
  })

  it('detects small high-contrast text changes and ignores low-amplitude noise', () => {
    const before = new Uint8Array(256 * 144 * 4).fill(120)
    const noise = before.map(value => value + 2)
    expect(CLINVEXAFrameChanged(before, noise)).toBe(false)
    const text = before.slice(); text.fill(220, 0, 100)
    expect(CLINVEXAFrameChanged(before, text)).toBe(true)
  })
})
