import { BrowserWindow, clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron'

import type { CopilotFillResult, CopilotResult } from '../src/clinvexa/copilot/types'

import { CLINVEXAFrameChanged } from './clinvexa'
import { createCopilotController, selectedSuggestions, withQuickFillClipboardFallback } from './clinvexa-copilot'
import { runCLINVEXAFocusedFill, runCLINVEXAQuickFill } from './clinvexa-fill'

interface RuntimeDependencies {
  consultationId?: () => string
  request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => Promise<T>
  capture: (identity: { windowId: string; title: string; processName: string }) => Promise<{ imageDataUrl: string; fingerprint: Uint8Array }>
  fingerprint: (imageDataUrl: string) => Uint8Array
  setExpanded: (expanded: boolean) => void
  setPaused: (paused: boolean) => void
  trusted: (url: string) => boolean
}

export function installCLINVEXACopilot(deps: RuntimeDependencies) {
  let filling = false

  const controller = createCopilotController({
    analyze: async (frame, question, sourceText, signal, onProgress, resultId) => {
      let ended = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const poll = async () => {
        try {
          const progress = await deps.request<{ messages: string[] }>(`/api/clinvexa/copilot/progress/${encodeURIComponent(frame.frameId)}`, 'GET', undefined, signal)

          if (!ended && progress.messages.length) {onProgress?.(progress.messages)}
        } catch { /* The final analysis request reports any connection failure. */ }

        if (!ended && !signal.aborted) {timer = setTimeout(() => void poll(), 400)}
      }

      timer = setTimeout(() => void poll(), 250)

      try {return await deps.request<CopilotResult>('/api/clinvexa/copilot/analyze', 'POST', {
      frameId: frame.frameId, windowId: frame.windowId, processName: frame.processName,
      title: frame.title, capturedAt: frame.capturedAt, imageDataUrl: frame.imageDataUrl,
      question, sourceText, resultId, consultationId: deps.consultationId?.() ?? ''
      }, signal)} finally {ended = true; clearTimeout(timer)}
    },
    publish: state => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && deps.trusted(win.webContents.getURL())) {win.webContents.send('clinvexa:copilot:state', state)}
      }
    }
  })

  const handle = (name: string, action: (...args: any[]) => unknown) => {
    ipcMain.handle(`clinvexa:copilot:${name}`, (event: IpcMainInvokeEvent, ...args: any[]) => {
      if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !deps.trusted(event.senderFrame.url)) {
        throw new Error('此页面不能控制医生副驾驶')
      }

      return action(...args)
    })
  }

  handle('get-state', () => controller.snapshot())
  handle('expanded', (expanded: boolean) => {
    deps.setExpanded(Boolean(expanded))
    controller.setExpanded(Boolean(expanded))
  })
  handle('enabled', (enabled: boolean) => deps.setPaused(!enabled))
  handle('start-fill-mode', async (id: string) => {
    if (!/^[\w-]{1,80}$/.test(id)) {throw new Error('无效结果')}
    const current = controller.snapshot().result
    const result = current?.id === id ? current : (await deps.request<CopilotResult[]>('/api/clinvexa/copilot/results')).find(row => row.id === id)

    if (!result) {throw new Error('未找到需要填写的结果，请刷新任务历史')}

    if (!controller.snapshot().enabled) {deps.setPaused(false)}

    controller.startFillMode(result)
  })
  handle('stop-fill-mode', () => controller.stopFillMode())
  handle('analyze', (question = '', source = '', expectedFrameId?: string, resultId = '') => controller.request(String(question), String(source), expectedFrameId, String(resultId)))
  handle('history', () => deps.request('/api/clinvexa/copilot/results'))
  handle('task-history', (key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key)) {throw new Error('无效任务')}

    return deps.request(`/api/clinvexa/copilot/tasks/${key}/results`)
  })
  handle('knowledge', () => deps.request('/api/clinvexa/copilot/knowledge'))
  handle('add-knowledge', (source: unknown) => deps.request('/api/clinvexa/copilot/knowledge', 'POST', source))
  handle('versions', (id: string) => {
    if (!/^[\w-]{1,80}$/.test(id)) {throw new Error('无效结果')}

    return deps.request(`/api/clinvexa/copilot/results/${id}/versions`)
  })
  handle('save-draft', async (id: string, revision: number, draft: string) => {
    if (!/^[\w-]{1,80}$/.test(id)) {throw new Error('无效结果')}
    const result = await deps.request<CopilotResult>(`/api/clinvexa/copilot/results/${id}/draft`, 'PUT', { revision, draft })
    controller.replaceResult(result)

    return result
  })
  handle('copy', async (id: string, ids: string[]): Promise<CopilotFillResult> => {
    const current = controller.snapshot().result
    const result = current?.id === id ? current : (await deps.request<CopilotResult[]>('/api/clinvexa/copilot/results')).find(row => row.id === id)
    const selected = selectedSuggestions(result ?? null, id, ids)
    clipboard.writeText(selected.map(item => selected.length === 1 ? item.text : `${item.title}\n${item.text}`).join('\n\n'))

    return { status: 'copied', message: '已复制，可在目标输入框按 Ctrl+V 粘贴', fields: [] }
  })
  handle('fill', async (id: string, ids: string[]): Promise<CopilotFillResult> => {
    if (filling) {throw new Error('正在填写，请等待字段核对结果')}
    const state = controller.snapshot()
    const selected = selectedSuggestions(state.result, id, ids)
    const frame = controller.latestFrame()
    const fallback = (message: string): CopilotFillResult => ({ status: 'failed', message, fields: [] })

    const focusedFill = state.fillMode && selected.length === 1

    if (!focusedFill && selected.some(item => item.kind === 'advice' || !item.targetLabel)) {
      return fallback('所选内容包含提醒或未定位的字段，请复制使用，或只选择已定位字段')
    }

    const sourceIsCurrent = frame?.frameId === state.result.frameId
    const ready = state.fillMode ? Boolean(frame) : (!state.stale && sourceIsCurrent)

    if (!state.enabled || !frame || !ready) {
      return fallback(state.fillMode
        ? '本次结果已保留。请切换到需要接收内容的 HIS 页面，保持看屏开启后再填写。'
        : '当前页面已有变化。请先选择“保留本结果可实现快捷填写”，再点击目标系统的输入框。')
    }

    filling = true

    try {
      if (focusedFill) {
        const direct = await runCLINVEXAFocusedFill({ windowId:frame.windowId, text:selected[0].text,
          label:selected[0].targetLabel || selected[0].title })

        return withQuickFillClipboardFallback(direct, selected, text => clipboard.writeText(text))
      }

      const current = await deps.capture(frame)

      if (CLINVEXAFrameChanged(deps.fingerprint(frame.imageDataUrl!), current.fingerprint)
          || controller.snapshot().frameId !== frame.frameId || !controller.snapshot().enabled) {
        return fallback('目标画面已改变，未执行填写。请重新读取或复制所选。')
      }

      const direct = await runCLINVEXAQuickFill({ windowId: frame.windowId, title: frame.title,
        patientId: state.result.patientId, encounterId: state.result.encounterId,
        fields: selected.map(item => ({ label: item.targetLabel, text: item.text })) })

      return withQuickFillClipboardFallback(direct, selected, text => clipboard.writeText(text))
    } finally { filling = false }
  })

  return controller
}
