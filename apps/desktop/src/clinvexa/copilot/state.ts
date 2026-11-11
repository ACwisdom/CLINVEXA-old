import { atom } from 'nanostores'

import type { CopilotState } from './types'

export const $copilot = atom<CopilotState>({ enabled: false, expanded: false, fillMode: false, status: 'off', error: null,
  frameId: null, result: null, stale: true, startedAt: null, target: null })

let subscribers = 0
let disconnect: (() => void) | undefined
let epoch = 0

/** One IPC subscription per renderer, with stale initial reads rejected. */
export function connectCopilot(): () => void {
  const bridge = window.hermesDesktop?.CLINVEXACopilot

  if (!bridge) {return () => {}}
  subscribers += 1

  if (subscribers === 1) {
    const ticket = ++epoch
    let received = false
    disconnect = bridge.onState(state => {received = true; $copilot.set(state)})
    void bridge.getState().then(state => {if (epoch === ticket && !received) {$copilot.set(state)}})
      .catch(() => {if (epoch === ticket && !received) {$copilot.set({ ...$copilot.get(), status: 'error', error: '副驾驶连接失败，请重启 CLINVEXA' })}})
  }

  return () => {
    subscribers -= 1

    if (subscribers === 0) {epoch += 1; disconnect?.(); disconnect = undefined}
  }
}
