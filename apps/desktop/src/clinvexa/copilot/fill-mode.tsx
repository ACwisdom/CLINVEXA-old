import { Button } from '@/components/ui/button'

import { useCopilotLabels } from './labels'
import type { CopilotResult, CopilotState } from './types'

export function quickFillReady(state: CopilotState, result: CopilotResult): boolean {
  if (!state.enabled || !state.frameId) {return false}

  if (state.fillMode) {return state.result?.id === result.id && Boolean(state.target)}

  return !state.stale && state.result?.id === result.id && state.frameId === result.frameId
}

export function CopilotFillMode({ result, state, onNotice }: { result: CopilotResult; state: CopilotState; onNotice?: (message: string) => void }) {
  const l = useCopilotLabels()
  const active = state.fillMode && state.result?.id === result.id
  const targetReady = active && Boolean(state.target)

  const run = async (operation: () => Promise<void> | undefined) => {
    try {await operation(); onNotice?.('')} catch (error) {onNotice?.(error instanceof Error ? error.message : l.errorRetry)}
  }

  return <div className={`dc-fill-mode ${active ? 'dc-fill-mode-active' : ''}`}>
    <div>
      <strong>{active ? l.fillModeActive : l.fillModeTitle}</strong>
      <p>{active ? (targetReady ? l.fillTargetReady : l.fillSwitchTarget) : l.fillModeHelp}</p>
      {targetReady && <small>{l.fillTarget} · {state.target?.title || state.target?.processName}</small>}
    </div>
    {active
      ? <Button onClick={() => void run(() => window.hermesDesktop?.CLINVEXACopilot?.stopFillMode())} size="sm" variant="outline">{l.stopFillMode}</Button>
      : <Button onClick={() => void run(() => window.hermesDesktop?.CLINVEXACopilot?.startFillMode(result.id))} size="sm">{l.startFillMode}</Button>}
  </div>
}
