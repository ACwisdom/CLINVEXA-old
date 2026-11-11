import { randomUUID } from 'node:crypto'

import type { CopilotFillResult, CopilotResult, CopilotState, CopilotSuggestion } from '../src/clinvexa/copilot/types'

import type { CLINVEXAScreenContext } from './clinvexa'

export interface CopilotFrame extends CLINVEXAScreenContext { frameId: string }

interface Dependencies {
  analyze: (frame: CopilotFrame, question: string, sourceText: string, signal: AbortSignal, onProgress?: (messages: string[]) => void, resultId?: string) => Promise<CopilotResult>
  publish: (state: CopilotState) => void
  now?: () => number
  debounceMs?: number
}

/** One active request, one latest frame, no unbounded screenshot/agent queue. */
export function createCopilotController(deps: Dependencies) {
  const now = deps.now ?? Date.now

  let state: CopilotState = {
    enabled: false, expanded: false, fillMode: false, status: 'off', error: null, frameId: null,
    result: null, stale: true, startedAt: null, target: null
  }

  let frame: CopilotFrame | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false
  let generation = 0
  let queued = false
  let question = ''
  let sourceText = ''
  let previousResultId = ''
  let failures = 0
  let abort: AbortController | null = null
  let pendingSince: number | null = null
  let contextVersion = 0
  let activatedAt: number | null = null

  const publish = (patch: Partial<CopilotState>) => {
    state = { ...state, ...patch }
    deps.publish(state)
  }

  const clearTimer = () => { if (timer) {clearTimeout(timer)}; timer = null }

  const schedule = () => {
    clearTimer()

    if (state.enabled && !state.fillMode && frame && failures < 3) {
      pendingSince ??= now()
      timer = setTimeout(() => void run(), Math.min(deps.debounceMs ?? 450, Math.max(0, 4000 - (now() - pendingSince))))
    }
  }

  const run = async () => {
    if (!state.enabled || state.fillMode || !frame) {return}

    if (active) {
      // The debounce has settled on a newer screen. Do not spend another
      // full model round waiting for a result that cannot be shown anymore.
      queued = true
      generation += 1
      abort?.abort(new Error('画面已更新，正在分析最新画面'))
      return
    }

    pendingSince = null
    active = true
    const requestAbort = new AbortController()
    abort = requestAbort
    const deadline = setTimeout(() => requestAbort.abort(new Error('视觉分析已到 30 秒上限，请重试或缩小当前窗口')), 30_000)
    queued = false
    const requestFrame = frame
    const ticket = generation
    const requestContextVersion = contextVersion
    const requestQuestion = question
    const requestSource = sourceText
    const requestResultId = previousResultId
    question = ''
    sourceText = ''
    previousResultId = ''
    publish({ status: 'analyzing', error: null, startedAt: now(), analysisProgress: ['已取得当前画面，正在准备分析'] })

    try {
      const result = await Promise.race([
        deps.analyze(requestFrame, requestQuestion, requestSource, requestAbort.signal, messages => {
          if (generation === ticket && frame?.frameId === requestFrame.frameId && !requestAbort.signal.aborted) {publish({ analysisProgress: messages })}
        }, requestResultId),
        new Promise<never>((_resolve, reject) => requestAbort.signal.addEventListener('abort', () => reject(requestAbort.signal.reason), { once: true }))
      ])

      if (generation !== ticket || !state.enabled) {return}
      failures = 0

      // Completed older frames stay in backend history, never become the active patient.
      if (frame?.frameId === requestFrame.frameId) {
        const deliveryStarted = activatedAt ?? requestFrame.observedAt ?? requestFrame.capturedAt
        publish({ result: { ...result, deliveryMs: Math.max(0, now() - deliveryStarted) }, status: 'ready', stale: requestContextVersion !== contextVersion, startedAt: null })
        activatedAt = null
      }
    } catch (error) {
      if (generation !== ticket || !state.enabled) {return}
      failures += 1
      publish({ status: 'error', error: error instanceof Error ? error.message : String(error), startedAt: null })
    } finally {
      clearTimeout(deadline)

      if (abort === requestAbort) {abort = null}
      active = false

      if (state.enabled && !state.fillMode && (queued || frame?.frameId !== requestFrame.frameId)) {schedule()}
    }
  }

  return {
    snapshot: () => state,
    latestFrame: () => frame,
    refreshContext() {
      contextVersion += 1
      failures = 0

      if (state.fillMode) {return}

      publish({ stale: true })

      if (active) {queued = true}
      else {schedule()}
    },
    setExpanded(expanded: boolean) { publish({ expanded }) },
    startFillMode(result: CopilotResult) {
      generation += 1
      abort?.abort(new Error('已切换到快捷填写模式'))
      clearTimer()
      failures = 0
      queued = false
      pendingSince = null
      question = ''
      sourceText = ''
      previousResultId = ''
      publish({ fillMode: true, result, status: 'ready', stale: false, error: null, startedAt: null,
        analysisProgress: ['已保留本次结果，等待点击目标系统的输入框'] })
    },
    stopFillMode() {
      if (!state.fillMode) {return}
      failures = 0
      publish({ fillMode: false, status: state.enabled ? 'watching' : 'off', stale: true, error: null,
        analysisProgress: undefined })
      schedule()
    },
    setEnabled(enabled: boolean) {
      activatedAt = enabled ? now() : null
      generation += 1
      abort?.abort(new Error('看屏状态已改变'))
      failures = 0
      clearTimer()
      frame = null
      pendingSince = null
      question = ''
      sourceText = ''
      previousResultId = ''
      publish({ enabled, frameId: null, target: null, status: enabled ? 'watching' : 'off', stale: true, error: null, startedAt: null })

      if (enabled) {schedule()}
    },
    invalidate() {
      frame = null
      clearTimer()
      publish({ stale: !state.fillMode, frameId: null, target: null, status: state.enabled ? (state.fillMode ? 'ready' : 'watching') : 'off' })
    },
    observe(context: CLINVEXAScreenContext) {
      if (!state.enabled || !context.imageDataUrl) {return}
      frame = { ...context, frameId: randomUUID() }
      publish({ frameId: frame.frameId, target: { title: context.title, processName: context.processName, windowId: context.windowId },
        stale: !state.fillMode, status: state.fillMode ? 'ready' : state.status, error: null })

      if (state.fillMode) {return}

      schedule()
    },
    request(nextQuestion = '', nextSource = '', expectedFrameId?: string, resultId = '') {
      if (!state.enabled || !frame) {throw new Error('请先开启看屏并打开需要辅助的页面')}

      if (state.fillMode) {throw new Error('请先结束快捷填写，再分析当前画面')}

      if (expectedFrameId && frame.frameId !== expectedFrameId) {throw new Error('画面已变化，请核对当前资料后重新分析')}

      if (active) {throw new Error('正在分析当前画面，请等待本次完成后追问')}
      question = nextQuestion.slice(0, 2000)
      sourceText = nextSource.slice(0, 12000)
      previousResultId = resultId
      failures = 0
      clearTimer()
      void run()
    },
    replaceResult(result: CopilotResult) {
      if (state.result?.id === result.id) {publish({ result })}
    },
    fail(message: string) { publish({ status: 'error', error: message, stale: true, startedAt: null }) },
    dispose() { generation += 1; abort?.abort(); clearTimer(); state = { ...state, enabled: false } }
  }
}

/** Reject mixed versions or empty selections before any clipboard/native action. */
export function selectedSuggestions(result: CopilotResult | null, resultId: string, ids: string[]) {
  if (!result || result.id !== resultId || !Array.isArray(ids) || ids.length === 0 || ids.length > 25) {
    throw new Error('请重新选择当前结果')
  }

  const selected = [...new Set(ids)].map(id => result.suggestions.find(item => item.id === id))

  if (selected.some(item => !item)) {throw new Error('所选建议已更新，请重新选择')}

  return selected.filter((item): item is NonNullable<typeof item> => Boolean(item))
}

export function withQuickFillClipboardFallback(direct: CopilotFillResult, selected: CopilotSuggestion[], write: (text: string) => void): CopilotFillResult {
  if (direct.status !== 'failed') {return direct}
  write(selected.map(item => selected.length === 1 ? item.text : `${item.title}\n${item.text}`).join('\n\n'))

  return { status:'copied', message:`${direct.message}。内容已自动复制，请在目标输入框按 Ctrl+V 粘贴。`, fields:direct.fields }
}
