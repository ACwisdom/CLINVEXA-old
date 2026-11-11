import { atom } from 'nanostores'

export type CLINVEXAMonitorStatus = 'failed' | 'monitoring' | 'paused' | 'processing'

export interface CLINVEXAScreenContext {
  capturedAt: number
  imageDataUrl?: string
  latencyMs: number
  observedAt: number
  processName: string
  title: string
  windowId: string
}

export interface CLINVEXARendererScreenState {
  context: CLINVEXAScreenContext | null
  error: string | null
  status: CLINVEXAMonitorStatus
}

export const $CLINVEXAScreen = atom<CLINVEXARendererScreenState>({
  context: null,
  error: null,
  status: 'monitoring'
})

/** Pause or resume capture while making the new state visible immediately. */
export function toggleCLINVEXAMonitoring(): void {
  const paused = $CLINVEXAScreen.get().status === 'paused'
  $CLINVEXAScreen.set({
    ...$CLINVEXAScreen.get(),
    status: paused ? 'monitoring' : 'paused'
  })
  window.hermesDesktop?.CLINVEXAScreen?.setPaused(!paused)
}

/** Connect the renderer state to the Electron screen-monitor bridge. */
export function initCLINVEXAScreenBridge(): () => void {
  const bridge = window.hermesDesktop?.CLINVEXAScreen

  if (!bridge) {
    return () => {}
  }

  void bridge.getState().then(state => $CLINVEXAScreen.set(state))

  return bridge.onState(state => $CLINVEXAScreen.set(state))
}
