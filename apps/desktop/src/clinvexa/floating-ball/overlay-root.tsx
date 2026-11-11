import { useStore } from '@nanostores/react'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

import { I18nProvider } from '@/i18n'
import { ThemeProvider } from '@/themes/context'

import { $consultation, mirrorConsultation } from '../consultation/live-session'
import { useCopilotLabels } from '../copilot/labels'
import { CopilotPanel } from '../copilot/panel'
import { $copilot, connectCopilot } from '../copilot/state'

import { CLINVEXAFloatingBall } from '.'

function CLINVEXABallOverlay() {
  const state = useStore($copilot)
  const consultation = useStore($consultation)
  const l = useCopilotLabels()
  useEffect(connectCopilot, [])
  useEffect(mirrorConsultation, [])

  if (state.expanded) {return <CopilotPanel />}

  return (
    <CLINVEXAFloatingBall
      active={state.enabled || consultation.status === 'recording'}
      expanded={false}
      hasSuggestions={Boolean(state.result && !state.stale)}
      onContextMenu={() => window.hermesDesktop?.CLINVEXAWindow?.showContextMenu()}
      onOpen={() => void window.hermesDesktop?.CLINVEXACopilot?.setExpanded(true)}
      statusLabel={l[state.status]}
    />
  )
}

/** Mount the always-on-top CLINVEXA entry without a second Hermes connection. */
export function mountCLINVEXABall(): void {
  const style = document.createElement('style')
  style.textContent = 'html,body,#root{background:transparent !important;}'
  document.head.appendChild(style)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider configClient={null} initialLocale="zh">
        <ThemeProvider><CLINVEXABallOverlay /></ThemeProvider>
      </I18nProvider>
    </StrictMode>
  )
}
