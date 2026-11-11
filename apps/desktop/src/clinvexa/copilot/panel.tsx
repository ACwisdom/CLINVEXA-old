import './copilot.css'
import '../workspace.css'

import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Activity, ArrowUpRight, Eye, FileText, Pause, Play, RefreshCw, X } from '@/lib/icons'

import { CLINVEXAConsultation } from '../consultation'
import { $consultation } from '../consultation/live-session'
import { useWorkspaceLabels } from '../workspace-labels'

import { CopilotFillMode, quickFillReady } from './fill-mode'
import { useCopilotLabels } from './labels'
import { $copilot, connectCopilot } from './state'
import { CopilotSuggestions } from './suggestions'
import type { CopilotResult } from './types'

export function CopilotMaterial({ result }: { result: CopilotResult }) {
  const l = useCopilotLabels()
  const workspace = useWorkspaceLabels()

  return <div className="dc-material">
    {result.consultationId && <p className="dc-notice">{workspace.voiceSource} · {result.consultationSegments}</p>}
    <h3>{l.facts}</h3>
    <ul>{result.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul>
    <h3>{l.missing}</h3>
    <ul>{result.missing.map((item, i) => <li key={i}>{item}</li>)}</ul>
    <h3>{l.source}</h3>
    {!result.sources.length && <p className="dc-muted">{l.noSource}</p>}
    {result.sources.map(source => <div key={source.id}>
      <strong>{source.title}</strong><p className="dc-muted">{source.version} · {source.reviewer} · {source.reviewedAt}</p>
    </div>)}
    <p className="dc-muted">{l.sourceDate} · {new Date(result.capturedAt).toLocaleString()}</p>
    <p className="dc-muted">{l.scope}</p>
  </div>
}

export function CopilotPanel() {
  const l = useCopilotLabels()
  const workspace = useWorkspaceLabels()
  const consultation = useStore($consultation)
  const [mode, setMode] = useState<'screen' | 'consultation'>('screen')
  const state = useStore($copilot)
  const [tab, setTab] = useState<'suggestions' | 'material'>('suggestions')
  const [question, setQuestion] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [sourceFrame, setSourceFrame] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [asking, setAsking] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [tick, setTick] = useState(Date.now())
  useEffect(connectCopilot, [])
  useEffect(() => {
    if (state.status !== 'analyzing') {return}
    const timer = setInterval(() => setTick(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [state.status])
  useEffect(() => {
    if (pendingQuestion && state.status === 'ready' && state.result?.question === pendingQuestion) {
      setQuestion('')
      setPendingQuestion('')
    }
  }, [pendingQuestion, state.result, state.status])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.stopPropagation(); void window.hermesDesktop?.CLINVEXACopilot?.setExpanded(false)}
    }

    window.addEventListener('keydown', listener)

    return () => window.removeEventListener('keydown', listener)
  }, [])

  const run = async (operation: () => Promise<unknown> | undefined) => {
    setNotice('')

    try {await operation();

 return true} catch (error) {setNotice(error instanceof Error ? error.message : l.errorRetry);

 return false}
  }

  const result = state.result
  const submitQuestion = async () => {
    if (!question.trim() || asking) {return}
    if (sourceText && sourceFrame !== state.frameId) {setNotice(l.sourceChanged); return}
    setAsking(true)
    const submitted = question.trim()
    const ok = await run(() => window.hermesDesktop?.CLINVEXACopilot?.analyze(submitted, sourceText, state.frameId ?? undefined, result?.frameId === state.frameId && !state.stale ? result.id : undefined))
    if (ok) {setPendingQuestion(submitted)}
    setAsking(false)
  }

  return <section aria-label={l.copilot} className="dc-copilot dc-popup">
    <header className="dc-header">
      <div className="dc-brand"><Activity size={23} /><strong>CLINVEXA</strong><span>{l.copilot}</span></div>
      <div className="dc-row dc-no-drag">
        <Button aria-label={l.workbench} onClick={() => window.hermesDesktop?.CLINVEXAWindow?.openSidebar()} size="icon-sm" variant="ghost"><ArrowUpRight /></Button>
        <Button aria-label={l.collapse} onClick={() => void run(() => window.hermesDesktop?.CLINVEXACopilot?.setExpanded(false))} size="icon-sm" variant="ghost"><X /></Button>
      </div>
    </header>
    <nav aria-label={workspace.workspace} className="dc-assistant-mode">
      <button aria-pressed={mode === 'screen'} onClick={() => setMode('screen')} type="button">{workspace.copilot}</button>
      <button aria-pressed={mode === 'consultation'} onClick={() => setMode('consultation')} type="button">{workspace.consultation}{consultation.status === 'recording' ? ' ●' : ''}</button>
      <button onClick={() => window.hermesDesktop?.CLINVEXAWindow?.openSidebar('skills')} type="button">{workspace.skills}</button>
    </nav>
    {mode === 'consultation' ? <CLINVEXAConsultation compact onClose={() => setMode('screen')} onSendToMedicalAgent={() => window.hermesDesktop?.CLINVEXAWindow?.openSidebar('consultation')} /> : <>
    <div className="dc-context">
      <div className="dc-row dc-between">
        <span className={`dc-status dc-status-${state.status}`} role="status"><span className="dc-dot" />{l[state.status]}</span>
        <Button onClick={() => void run(() => window.hermesDesktop?.CLINVEXACopilot?.setEnabled(!state.enabled))} size="sm" variant="ghost">
          {state.enabled ? <Pause /> : <Play />}{state.enabled ? l.pause : l.start}
        </Button>
      </div>
      {state.target && <p className="dc-window-title"><Eye size={15} /><span>{state.target.title || state.target.processName}</span></p>}
    </div>
    {!state.enabled && !result ? <div className="dc-welcome">
      <Eye size={34} /><h2>{l.welcome}</h2><p>{l.introduction}</p>
      <Button onClick={() => void run(() => window.hermesDesktop?.CLINVEXACopilot?.setEnabled(true))} size="lg"><Play />{l.start}</Button>
      <p className="dc-muted dc-footnote">{l.disclosure}</p>
    </div> : <>
      <nav aria-label={l.copilot} className="dc-tabs">
        {(['suggestions', 'material'] as const).map(name => <button aria-current={tab === name ? 'page' : undefined} key={name} onClick={() => setTab(name)} type="button">{l[name]}</button>)}
      </nav>
      <div className="dc-panel-body">
        {(state.error || notice) && <p className="dc-notice" role="alert">{notice || state.error}</p>}
        {state.status === 'analyzing' && <p className="dc-muted" role="status">{l.analyzing} · {l.elapsed} {Math.max(0, Math.floor((tick - (state.startedAt ?? tick)) / 1000))} {l.seconds}</p>}
        {state.status === 'analyzing' && <div aria-live="polite" className="dc-analysis-progress" role="log">{state.analysisProgress?.map((line, index) => <p key={index}>{line}</p>)}</div>}
        {state.stale && result && <p className="dc-notice">{state.enabled ? l.stale : l.pausedResult}</p>}
        {tab === 'suggestions' && (result ? <>
          <h2 className="dc-summary">{result.summary}</h2>
          <CopilotFillMode onNotice={setNotice} result={result} state={state} />
          <CopilotSuggestions fillReady={quickFillReady(state, result)} focusedFill={state.fillMode} onAsk={setQuestion} result={result} />
        </> : <div className="dc-empty"><FileText size={26} /><p>{state.target ? l.empty : l.noWindow}</p></div>)}
        {tab === 'material' && (result ? <CopilotMaterial result={result} /> : <p className="dc-muted">{l.empty}</p>)}
      </div>
      <form className="dc-question dc-followup-composer" onSubmit={event => {event.preventDefault(); void submitQuestion()}}>
        <label htmlFor="dc-question">{l.question}</label>
        <textarea id="dc-question" maxLength={2000} onChange={event => setQuestion(event.target.value)} placeholder={l.questionPlaceholder} rows={3} value={question} />
        <details className="dc-followup-material">
          <summary>{l.sourceText}</summary>
          <textarea id="dc-source" aria-label={l.sourceText} maxLength={12000} onChange={event => {setSourceText(event.target.value); if (!sourceText) {setSourceFrame(state.frameId)}}} placeholder={l.sourcePlaceholder} rows={3} value={sourceText} />
          {sourceText && sourceFrame !== state.frameId && <div className="dc-notice"><p>{l.sourceChanged}</p><Button onClick={() => setSourceFrame(state.frameId)} type="button" variant="outline">{l.rebindSource}</Button></div>}
        </details>
        <Button disabled={!question.trim() || !state.enabled || !state.frameId || state.status === 'analyzing' || asking} size="sm" type="submit">{l.send}</Button>
      </form>
      <footer className="dc-footer dc-row dc-between">
        <span className="dc-muted">{result ? `${l.duration} ${((result.deliveryMs ?? result.latencyMs) / 1000).toFixed(1)} ${l.seconds}` : l.scope}</span>
        <Button disabled={!state.enabled || state.status === 'analyzing'} onClick={() => void run(() => window.hermesDesktop?.CLINVEXACopilot?.analyze())} size="sm" variant="ghost"><RefreshCw />{l.refresh}</Button>
      </footer>
    </>}
    </>}
  </section>
}
