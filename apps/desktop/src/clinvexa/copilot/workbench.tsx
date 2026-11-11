import { useStore } from '@nanostores/react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Activity, ArrowUpRight, BookOpen, Briefcase, CheckCircle2, Copy, FileText, RefreshCw, Save, X } from '@/lib/icons'

import { CopilotCompare } from './compare'
import { CopilotFillMode, quickFillReady } from './fill-mode'
import { CopilotKnowledge } from './knowledge'
import { useCopilotLabels } from './labels'
import { CopilotMaterial } from './panel'
import { $copilot, connectCopilot } from './state'
import { CopilotSuggestions } from './suggestions'
import type { CopilotResult } from './types'

export function resultDraft(result: Pick<CopilotResult, 'draft' | 'revision' | 'suggestions' | 'summary'>): string {
  return result.revision > 0 ? result.draft : result.suggestions.map(item => `${item.title}\n${item.text}`).join('\n\n') || result.summary
}

export function CopilotWorkbench({ onClose, embedded = false, navigation, requestedRecordId, requestedTaskKey }: { onClose: () => void; embedded?: boolean; navigation?: ReactNode; requestedRecordId?: string | null; requestedTaskKey?: string | null }) {
  const l = useCopilotLabels()
  const live = useStore($copilot)
  const [history, setHistory] = useState<CopilotResult[]>([])
  const [selected, setSelected] = useState<string | null>(requestedRecordId ?? null)
  const [filter, setFilter] = useState<'all' | 'clinical' | 'learning' | 'office'>('all')
  const [tab, setTab] = useState<'proposed' | 'draft' | 'original' | 'compare'>('proposed')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [question, setQuestion] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [versions, setVersions] = useState<{ revision: number; saved: number; draft: string }[]>([])
  useEffect(connectCopilot, [])

  const refresh = useCallback(async () => {
    try {
      const rows = await window.hermesDesktop?.CLINVEXACopilot?.history()

      if (rows) {setHistory(current => {
        const merged = new Map(current.map(row => [row.id, row]))

        for (const row of rows) {if ((merged.get(row.id)?.revision ?? -1) <= row.revision) {merged.set(row.id, row)}}

        return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
      })}
    } catch (error) {setNotice(error instanceof Error ? error.message : l.errorRetry)}
  }, [l.errorRetry])

  useEffect(() => {void refresh()}, [refresh])
  useEffect(() => {
    if (!requestedRecordId) return
    setSelected(requestedRecordId)
    setTab('proposed')
    setNotice('')
    let active = true
    const bridge = window.hermesDesktop?.CLINVEXACopilot
    const request = requestedTaskKey ? bridge?.taskHistory(requestedTaskKey) : bridge?.history()
    void request?.then(rows => {
      if (!active) return
      setHistory(current => {
        const merged = new Map(current.map(row => [row.id, row]))
        for (const row of rows) merged.set(row.id, row)
        return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
      })
      if (!rows.some(row => row.id === requestedRecordId)) setNotice('未找到这条历史结果，请刷新左侧记录后重试。')
    }).catch(() => {if (active) setNotice('历史结果读取失败，请刷新重试。')})
    return () => {active = false}
  }, [requestedRecordId, requestedTaskKey])
  useEffect(() => {
    if (!live.result) {return}
    const result = live.result
    setHistory(current => [result, ...current.filter(item => item.id !== result.id)].sort((a, b) => b.createdAt - a.createdAt))
    // Follow new results until the doctor explicitly selects a history entry.
    // Auto-pinning the first result left later successful analyses hidden.
  }, [live.result])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.stopPropagation(); onClose()}}
    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const result = selected ? history.find(item => item.id === selected) : history[0]
  const current = Boolean(result && result.id === live.result?.id)
  const taskKey = result?.taskKey
  useEffect(() => {
    if (!taskKey) {return}
    let active = true
    void window.hermesDesktop.CLINVEXACopilot?.taskHistory(taskKey).then(rows => {
      if (!active) {return}
      setHistory(currentRows => {
        const merged = new Map(currentRows.map(row => [row.id, row]))

        for (const row of rows) {if ((merged.get(row.id)?.revision ?? -1) <= row.revision) {merged.set(row.id, row)}}

        return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
      })
    }).catch(error => {if (active) {setNotice(String(error))}})

    return () => {active = false}
  }, [taskKey])

  const grouped = [...new Map([...history].reverse().map(row => [row.taskKey, row])).values()].sort((a, b) => b.createdAt - a.createdAt)
  const previousRows = result ? history.filter(row => row.taskKey === result.taskKey && row.createdAt < result.createdAt) : []
  const previous = previousRows.find(row => row.revision > 0) ?? previousRows[0]

  const visible = grouped.filter(row => filter === 'all'
    || (filter === 'clinical' && ['record', 'examination', 'report'].includes(row.scene))
    || (filter === 'learning' && row.scene === 'reading')
    || (filter === 'office' && ['writing', 'other'].includes(row.scene)))

  const draft = result ? (drafts[result.id] ?? resultDraft(result)) : ''
  useEffect(() => {
    setVersions([])

    if (!result || tab !== 'draft') {return}
    let active = true
    void window.hermesDesktop.CLINVEXACopilot?.versions(result.id).then(rows => {if (active) {setVersions(rows)}}).catch(error => {if (active) {setNotice(String(error))}})

    return () => {active = false}
  }, [result, tab])

  const copy = async () => {
    try {
      const copied = await window.hermesDesktop.writeClipboard(draft)

      if (!copied) {throw new Error(l.errorRetry)}
      setNotice(l.copied)
    } catch (error) {setNotice(error instanceof Error ? error.message : l.errorRetry)}
  }

  const save = async () => {
    if (!result || saving) {return}
    setSaving(true)

    try {
      const saved = await window.hermesDesktop.CLINVEXACopilot!.saveDraft(result.id, result.revision, draft)
      setHistory(rows => rows.map(row => row.id === saved.id ? saved : row))
      setNotice(l.saved)
    } catch (error) {setNotice(error instanceof Error ? error.message : l.errorRetry)}
    finally {setSaving(false)}
  }

  return <section aria-label={l.workbench} className={`dc-copilot dc-workbench ${embedded ? 'dc-workbench-embedded' : ''}`}>
    <header className="dc-workbench-header">
      <div className="dc-brand"><Activity size={25} /><strong>CLINVEXA</strong><span>{l.copilot}</span></div>
      <div className="dc-row">
        <Button onClick={() => void window.hermesDesktop.CLINVEXACopilot?.setExpanded(true)} variant="outline"><ArrowUpRight />{l.copilot}</Button>
        <Button aria-label={l.close} onClick={onClose} size="icon-sm" variant="ghost"><X /></Button>
      </div>
    </header>
    <div className="dc-workbench-grid">
      <aside className="dc-task-nav">
        {navigation || <nav aria-label={l.tools}>
          {([['all', Activity, l.allResults], ['clinical', FileText, l.clinical], ['learning', BookOpen, l.learning], ['office', Briefcase, l.office]] as const).map(([key, Icon, text]) =>
            <button aria-current={filter === key ? 'page' : undefined} key={key} onClick={() => setFilter(key)} type="button"><Icon size={17} />{text}</button>)}
        </nav>}
        <div className="dc-row dc-between dc-history-label"><span>{l.history}</span><Button aria-label={l.refreshHistory} onClick={() => void refresh()} size="icon-xs" variant="ghost"><RefreshCw /></Button></div>
        <div className="dc-task-list">
          {!visible.length && <p className="dc-muted">{l.noHistory}</p>}
          {visible.map(item => <button aria-pressed={result?.taskKey === item.taskKey} className="dc-task" key={item.id} onClick={() => {setSelected(item.id); setNotice('')}} type="button">
            <strong>{item.patientName || item.title || l.copilot}</strong>
            <span>{item.summary.slice(0, 55)}</span>
            <small>{new Date(item.createdAt).toLocaleTimeString()} · {item.id === live.result?.id ? l.current : l.resultReady}</small>
          </button>)}
        </div>
      </aside>
      <section aria-label={l.progress} className="dc-task-progress">
        <h2>{l.progress}</h2>
        <div className="dc-progress-body">
          {live.error && <div className="dc-notice" role="alert">
            <strong>{l.currentFailure}</strong>
            {live.target && <p>{live.target.title || live.target.processName}</p>}
            <p>{live.error}</p>
            {result && <p>{l.savedUnaffected}</p>}
            <Button disabled={!live.enabled || !live.frameId || live.status === 'analyzing'} onClick={() => {
              setNotice('')
              void window.hermesDesktop.CLINVEXACopilot?.analyze('', '', live.frameId ?? undefined).catch(error => setNotice(String(error)))
            }} variant="outline">{l.refresh}</Button>
          </div>}
          {live.status === 'analyzing' && <p className="dc-notice" role="status">{l.analyzing} · {live.target?.title}</p>}
          {live.status === 'analyzing' && <div aria-live="polite" className="dc-analysis-progress" role="log">{live.analysisProgress?.map((line, index) => <p key={index}>{line}</p>)}</div>}
          {result ? <>
            <p className="dc-notice">{!live.enabled ? l.pausedResult : !current ? l.historical : live.stale ? l.stale : l.current}</p>
            <label className="dc-history-select">{l.resultHistory}<select onChange={event => setSelected(event.target.value)} value={result.id}>{history.filter(row => row.taskKey === result.taskKey).map(row => <option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString()} · {row.revision > 0 ? `${l.draft} ${row.revision}` : l.proposed}</option>)}</select></label>
            <p className="dc-muted">{result.title}</p>
            <h3>{result.patientName || l.copilot}</h3>
            {result.patientId && <p className="dc-muted">{l.patient} {result.patientId} · {l.encounter} {result.encounterId}</p>}
            <ol className="dc-timeline">
              <li><CheckCircle2 size={16} /><div>{l.screenRead}<small>{new Date(result.capturedAt).toLocaleString()}</small></div></li>
              <li><CheckCircle2 size={16} /><div>{l.visualAnalysis}<small>{((result.deliveryMs ?? result.latencyMs) / 1000).toFixed(1)} {l.seconds}</small></div></li>
              <li><CheckCircle2 size={16} /><div>{l.resultReady}<small>{new Date(result.createdAt).toLocaleTimeString()}</small></div></li>
            </ol>
            {result.question && <p className="dc-notice">{result.question}</p>}
            <p className="dc-summary">{result.summary}</p>
            {result.missing.length > 0 && <div className="dc-material"><h3>{l.missing}</h3><ul>{result.missing.map((value, i) => <li key={i}>{value}</li>)}</ul></div>}
          </> : <p className="dc-muted">{live.enabled ? l[live.status] : l.introduction}</p>}
          {notice && <p className="dc-notice" role="status">{notice}</p>}
        </div>
        <form className="dc-question dc-task-composer" onSubmit={event => {
          event.preventDefault()
          if (!question.trim()) return
          void window.hermesDesktop.CLINVEXACopilot?.analyze(question.trim(), '', live.frameId ?? undefined, current && !live.stale ? result?.id : undefined).then(() => setQuestion('')).catch(error => setNotice(String(error)))
        }}>
          <label htmlFor="dc-work-question">{l.question}</label>
          <textarea id="dc-work-question" maxLength={2000} onChange={event => setQuestion(event.target.value)} placeholder={l.questionPlaceholder} rows={3} value={question} />
          <Button disabled={!question.trim() || !current || !live.enabled || live.status === 'analyzing'} type="submit">{l.send}</Button>
        </form>
      </section>
      <section aria-label={l.result} className="dc-task-result">
        <h2>{l.result}</h2>
        <nav aria-label={l.result} className="dc-tabs">{(['proposed', 'draft', 'compare', 'original'] as const).map(key => <button aria-current={tab === key ? 'page' : undefined} key={key} onClick={() => setTab(key)} type="button">{l[key]}</button>)}</nav>
        <div className="dc-result-body">
          {result && tab === 'proposed' && <><CopilotFillMode onNotice={setNotice} result={result} state={live} /><CopilotSuggestions fillReady={quickFillReady(live, result)} focusedFill={live.fillMode} onAsk={value => setQuestion(value)} result={result} /></>}
          {tab === 'original' && <>{result && <CopilotMaterial result={result} />}<CopilotKnowledge /></>}
          {result && tab === 'compare' && <CopilotCompare currentDraft={drafts[result.id] ?? (result.revision > 0 ? result.draft : undefined)} key={result.id} onApply={value => {setDrafts(rows => ({...rows, [result.id]: value})); setTab('draft')}} previous={previous} result={result} />}
          {result && tab === 'draft' && <div className="dc-draft-editor">
            <p className="dc-muted">{l.draftHelp}</p>
            <textarea aria-label={l.draft} className="dc-draft" maxLength={50000} onChange={event => setDrafts(values => ({ ...values, [result.id]: event.target.value }))} value={draft} />
            <div className="dc-row dc-between"><span className="dc-muted">{l.revision} {result.revision}</span><div className="dc-row">
              <Button onClick={() => void copy()} variant="outline"><Copy />{l.copyDraft}</Button>
              <Button disabled={saving} onClick={() => void save()}><Save />{l.save}</Button>
            </div></div>
            {versions.length > 0 && <details className="dc-material"><summary>{l.versions} · {versions.length}</summary>{versions.map(version => <div key={version.revision}><p>{l.revision} {version.revision} · {new Date(version.saved).toLocaleString()}</p><pre className="dc-version-text">{version.draft}</pre><Button onClick={() => setDrafts(values => ({...values, [result.id]: version.draft}))} variant="outline">{l.restore}</Button></div>)}</details>}
          </div>}
          {!result && <div className="dc-empty"><FileText size={30} /><p>{l.empty}</p></div>}
        </div>
      </section>
    </div>
  </section>
}
