import './workspace.css'

import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'

import { onCLINVEXAHomeAction } from '@/app/clinvexa-home/events'
import { navigateToWorkspacePage } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { type ChatMessage } from '@/lib/chat-messages'
import { $messages } from '@/store/session'

import {
  buildCLINVEXAAgentPrompt,
  type CLINVEXAAgentId,
  type CLINVEXARouteTarget,
  routeCLINVEXATask
} from './agent-prompt'
import { CLINVEXAConsultation } from './consultation'
import { ownConsultation } from './consultation/live-session'
import { ContractWorkspace } from './contracts/workspace'
import { CopilotWorkbench } from './copilot/workbench'
import { type CLINVEXAPage, CLINVEXAPageForPath, CLINVEXAPagePath } from './navigation'
import { $CLINVEXAPageHost } from './page-host'
import { $platformConnection } from './platform'
import { CLINVEXARpa } from './rpa'
import { initCLINVEXAScreenBridge } from './screen-monitor/state'
import { CLINVEXASidebar } from './sidebar'
import { CLINVEXASkillPlaza } from './skill-plaza'
import { SummonCopilotBall } from './summon-ball'
import type { SummonedAssistant } from './summon'
import { CLINVEXATaskStore } from './task-state'
import { CLINVEXAWorkbench } from './workbench'
import { CLINVEXAActivitiesFromMessages } from './workbench/activity'
import { useWorkspaceLabels } from './workspace-labels'

interface CLINVEXADesktopProps {
  onSummon: (assistant: SummonedAssistant) => Promise<void>
  onEnsurePersistedSession?: (preview: string) => Promise<boolean> | boolean
  onUpdateMessages?: (updater: (current: ChatMessage[]) => ChatMessage[]) => void
  onSubmitToNewSession?: (text: string) => Promise<boolean | void> | boolean | void
  onStop?: () => Promise<void> | void
  onSubmit: (text: string) => Promise<boolean | void> | boolean | void
}

/** Mount the CLINVEXA sidebar controlled by the standalone floating window. */
export function CLINVEXADesktop({ onSummon, onSubmitToNewSession, onStop, onSubmit }: CLINVEXADesktopProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const historyParams = new URLSearchParams(location.search)
  const page = CLINVEXAPageForPath(location.pathname)
  const host = useStore($CLINVEXAPageHost)
  const setPage = (next: CLINVEXAPage | null) => navigateToWorkspacePage(navigate, CLINVEXAPagePath(next))
  const l = useWorkspaceLabels()
  const platformAccount = useStore($platformConnection)
  const [skillSource, setSkillSource] = useState<'local' | 'platform'>('local')
  const [accountOpenVersion, setAccountOpenVersion] = useState(0)

  const openPlatform = () => {setSkillSource('platform'); setAccountOpenVersion(value => value + 1); setPage('skills')}
  const open = page !== null
  const consultationOpen = page === 'consultation'
  const skillPlazaOpen = page === 'skills'
  const workbenchOpen = page === 'activity'
  const rpaOpen = page === 'rpa'
  const setConsultationOpen = (value: boolean) => setPage(value ? 'consultation' : 'copilot')
  const setSkillPlazaOpen = (value: boolean) => setPage(value ? 'skills' : null)
  const setWorkbenchOpen = (value: boolean) => setPage(value ? 'activity' : 'copilot')
  const setRpaOpen = (value: boolean) => setPage(value ? 'rpa' : 'copilot')
  useEffect(ownConsultation, [])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const lastTaskRef = useRef<{ input: string; target: CLINVEXAAgentId } | null>(null)
  const messages = useStore($messages)
  const activities = CLINVEXAActivitiesFromMessages(messages)

  useEffect(() => {
    const stopScreenBridge = initCLINVEXAScreenBridge()

    const stopOpenBridge = window.hermesDesktop?.CLINVEXAWindow?.onOpenSidebar(target => {
      setPage(target === 'consultation' || target === 'skills' || target === 'activity' || target === 'rpa' ? target : 'copilot')
    })

    const stopHomeBridge = onCLINVEXAHomeAction(action => {
      if (action === 'platform-account') {openPlatform()}
      else if (action === 'consultation') {setPage('consultation')}
      else if (action === 'record-structuring' || action === 'all-medical-tools') {setPage('skills')}
      else if (action === 'rpa') {setPage('rpa')}
      else if (action === 'quality-check' || action === 'knowledge-search') {setPage('activity')}
    })

    return () => {
      stopScreenBridge()
      stopOpenBridge?.()
      stopHomeBridge()
    }
  }, [])

  const submit = async (
    text: string,
    target: CLINVEXARouteTarget = 'auto',
    sender: CLINVEXADesktopProps['onSubmit'] = onSubmit
  ): Promise<boolean> => {
    const resolvedTarget = target === 'auto' ? routeCLINVEXATask(text) : target
    lastTaskRef.current = { input: text, target: resolvedTarget }
    const correlationId = `manual-${Date.now()}-${text}`
    const task = CLINVEXATaskStore.submit({ correlationId, input: text, surface: 'sidebar' })
    CLINVEXATaskStore.update(task.id, 'running')

    try {
      const submitted = await sender(buildCLINVEXAAgentPrompt(text, resolvedTarget))

      if (submitted === false) {
        throw new Error('CLINVEXA gateway is not connected')
      }

      setSubmitError(null)

      return true
    } catch (error) {
      CLINVEXATaskStore.update(task.id, 'failed')
      const message = error instanceof Error ? error.message : String(error)
      setSubmitError(
        message.includes('Hermes gateway') || message.includes('CLINVEXA gateway')
          ? 'CLINVEXA 后台未连接，请点击恢复或重启 CLINVEXA 后再试'
          : message
      )

      return false
    }
  }

  const retryAgent = (agentId: CLINVEXAAgentId): void => {
    const task = lastTaskRef.current

    if (task) {
      void submit(task.input, agentId)
    }
  }

  const switchAgent = (_from: CLINVEXAAgentId, to: CLINVEXAAgentId): void => retryAgent(to)

  return open && host ? createPortal(
    <section aria-label={l.workspace} className="dc-main-page dc-copilot">
      <header className="dc-page-toolbar"><Button onClick={openPlatform} variant="ghost">{platformAccount?.connected ? `平台账号 · ${platformAccount.display_name}` : '平台账号登录'}</Button><SummonCopilotBall /></header>
      {submitError && <p className="dc-notice" role="alert">{submitError}</p>}
      {page === 'copilot' ? <CopilotWorkbench embedded navigation={<></>} requestedRecordId={historyParams.get('record')} requestedTaskKey={historyParams.get('task')} onClose={() => setPage(null)} /> : <div className="dc-unified-content">
      {open && consultationOpen && (
        <section className="dc-workspace-page">
          <CLINVEXAConsultation
            requestedRecordId={historyParams.get('record')}
            onClose={() => setConsultationOpen(false)}
            onSendToMedicalAgent={async prompt => {
              const submitted = await submit(prompt, 'medical_record', onSubmitToNewSession ?? onSubmit)

              if (submitted) {
                setPage('activity')
              }
            }}
          />
        </section>
      )}
      {open && skillPlazaOpen && (
        <section className="dc-workspace-page">
          <CLINVEXASkillPlaza
            initialSource={skillSource}
            key={accountOpenVersion}
            onClose={() => setSkillPlazaOpen(false)}
            onSummon={onSummon}
          />
        </section>
      )}
      {open && workbenchOpen && (
        <section className="dc-workspace-page dc-activity-grid">
          <CLINVEXASidebar embedded onClose={() => setPage('copilot')} onOpenConsultation={() => setPage('consultation')} onOpenRpa={() => setPage('rpa')} onOpenSkillPlaza={() => setPage('skills')} onOpenWorkbench={() => setPage('activity')} onStop={onStop} onSubmit={(text, target) => {void submit(text, target)}} />
          <CLINVEXAWorkbench
            activities={activities}
            onClose={() => setWorkbenchOpen(false)}
            onRetry={retryAgent}
            onSwitchAgent={switchAgent}
          />
        </section>
      )}
      {open && rpaOpen && (
        <section className="dc-workspace-page">
          <CLINVEXARpa onClose={() => setRpaOpen(false)} />
        </section>
      )}
      {page === 'contracts' && <ContractWorkspace />}
      </div>}
    </section>, host
  ) : null
}
