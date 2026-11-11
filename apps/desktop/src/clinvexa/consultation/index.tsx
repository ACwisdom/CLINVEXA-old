import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { Bookmark, Copy, Mic, Pause, Play, StopFilled, X } from '@/lib/icons'

import { useCopilotLabels } from '../copilot/labels'
import { $copilot, connectCopilot } from '../copilot/state'
import { useWorkspaceLabels } from '../workspace-labels'

import { type ConsultationMarkerLabel, getLiveVoiceStatus, type LiveVoiceStatus, prepareVoice, recentConsultations } from './api'
import { $consultation, canLoadConsultation, consultationAction } from './live-session'
import { buildConsultationAgentPrompt } from './prompt'

export function exportConsultationDraft(text: string, patientId: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  const safePatient = [...patientId].map(character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')
  anchor.download = `CLINVEXA_${safePatient}_${Date.now()}.txt`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const MARKERS: ConsultationMarkerLabel[] = ['chief_complaint', 'present_illness', 'past_history', 'allergy_history', 'medication_history', 'examination', 'assessment', 'plan', 'important']

export function CLINVEXAConsultation({ onClose, onSendToMedicalAgent, compact = false, requestedRecordId }: {
  onClose: () => void
  onSendToMedicalAgent: (prompt: string) => Promise<void> | void
  compact?: boolean
  requestedRecordId?: string | null
}) {
  const { t } = useI18n()
  const copy = t.CLINVEXA.consultation
  const l = useWorkspaceLabels()
  const shared = useCopilotLabels()
  const state = useStore($consultation)
  const screenContext = useStore($copilot)
  useEffect(connectCopilot, [])
  const [patientId, setPatientId] = useState('')
  const [patientName, setPatientName] = useState('')
  const [consent, setConsent] = useState(false)
  const [dialect, setDialect] = useState('auto')
  const [correction, setCorrection] = useState<{ text: string; count: number } | null>(null)
  const [screenTogether, setScreenTogether] = useState(true)
  const [markerNote, setMarkerNote] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const current = $consultation.get()
    if (!requestedRecordId || current.record?.id === requestedRecordId) return
    if (!canLoadConsultation(current)) {
      setNotice('请先结束当前录音、等待处理完成并保存草稿，再打开其他记录。')
      return
    }
    setNotice('')
    consultationAction({ type: 'load', id: requestedRecordId })
  }, [requestedRecordId])
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<Awaited<ReturnType<typeof recentConsultations>>>([])
  const [voice, setVoice] = useState<LiveVoiceStatus | null>(null)
  const detectedPatientId = !screenContext.stale ? screenContext.result?.patientId : ''
  useEffect(() => {
    if (state.status === 'setup' && detectedPatientId) {
      setPatientId(value => value || detectedPatientId)
    }
  }, [state.status, detectedPatientId])
  useEffect(() => {
    if (state.status !== 'setup') {return}
    let active = true
    let timer: ReturnType<typeof setTimeout>

    const check = async () => {
      try {
        const result = await getLiveVoiceStatus(dialect)

        if (active) {setVoice(result)}
        // First launch may still be provisioning when the initial warmup
        // request runs. Retry preparation after the service becomes reachable.
        if (active && result.installed && !result.ready && !result.error) {await prepareVoice(dialect)}
      } catch { if (active) {setVoice({ installed: false, ready: false, error: '无法连接本地语音服务，请等待服务启动或重新启动 CLINVEXA。' })} }

      if (active) {timer = setTimeout(() => void check(), 2000)}
    }

    void check()

    return () => {active = false; clearTimeout(timer)}
  }, [state.status, dialect])
  useEffect(() => {
    if (state.status !== 'setup' && state.status !== 'ready') {return}
    let active = true
    void recentConsultations().then(rows => {if (active) {setHistory(rows)}}, error => {if (active) {setNotice(String(error))}})

    return () => {active = false}
  }, [state.status])
  const active = state.status === 'recording' || state.status === 'paused'
  const record = state.record
  const seconds = Math.floor(state.elapsed / 1000)
  const statusLabel = state.status === 'ready' ? (state.analyzing ? '录音已结束 · AI 正在整理' : record?.analysis_mode === 'ai' ? '问诊草稿待核对' : '转写已保存 · 待分析') : state.status === 'starting' ? l.starting : state.status === 'failed' ? l.failed : copy.status[state.status]
  const voicePreparing = !voice?.installed || !voice.ready

  const draftActions = <div className="dc-consult-controls"><Button disabled={!state.dirty} onClick={() => consultationAction({ type: 'save' })} variant="outline">{state.dirty ? shared.save : shared.saved}</Button><Button disabled={!state.draft} onClick={() => {void navigator.clipboard.writeText(state.draft).then(() => setNotice(l.copied), () => setNotice(l.copyError))}} variant="outline"><Copy />{l.copy}</Button>
    <Button disabled={!record?.transcript || sending} onClick={() => {if (!record) {return}; setSending(true); void Promise.resolve(onSendToMedicalAgent(buildConsultationAgentPrompt({ ...record, draft_text: state.draft }))).catch(error => setNotice(String(error))).finally(() => setSending(false))}}>{sending ? l.running : compact ? l.workspace : l.continueAgent}</Button></div>

  return <section aria-label={copy.title} className={`dc-consultation ${compact ? 'dc-consultation-compact' : ''}`}>
    <header className="dc-section-header"><div><h2>{l.live}</h2><p className="dc-muted">{l.liveHelp}</p></div><Button aria-label={copy.title} onClick={onClose} size="icon-sm" variant="ghost"><X /></Button></header>
    <div className="dc-consult-status" role="status"><span className="dc-row"><Mic size={16} />{statusLabel}</span><span>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>{state.pending > 0 && <span>{l.queue} · {state.pending}</span>}{record && <strong>{record.patient_name || record.patient_id} · {record.patient_id}</strong>}</div>
    {(state.error || notice) && <p className="dc-notice" role={state.error ? 'alert' : 'status'}>{state.error || notice}</p>}
    {['setup', 'ready'].includes(state.status) && history.length > 0 && <label className="dc-history-select">{shared.history}<select disabled={state.dirty} onChange={event => consultationAction({ type: 'load', id: event.target.value })} value=""><option value="">{shared.history}</option>{history.map(row => <option key={row.id} value={row.id}>{row.patient_name || row.patient_id} · {new Date(row.started_at).toLocaleString()}</option>)}</select></label>}
    {(state.pending > 0 || state.status === 'failed') && <Button onClick={() => consultationAction({ type: 'retry' })} variant="outline">{l.retry}</Button>}
    {state.status === 'setup' || state.status === 'starting' ? <div className="dc-consult-setup">
      <label htmlFor="dc-cons-patient">{copy.patientId}</label><Input disabled={state.status === 'starting'} id="dc-cons-patient" onChange={event => setPatientId(event.target.value)} value={patientId} />
      <label htmlFor="dc-cons-name">{copy.patientName}</label><Input disabled={state.status === 'starting'} id="dc-cons-name" onChange={event => setPatientName(event.target.value)} value={patientName} />
      <label className="dc-history-select" htmlFor="dc-cons-dialect">问诊语言
        <select disabled={state.status === 'starting'} id="dc-cons-dialect" onChange={event => setDialect(event.target.value)} value={dialect}>
          <option value="auto">自动识别 · 普通话 / 粤语</option><option value="zh">普通话</option>
          <option value="yue">粤语</option><option disabled={!voice?.dialects?.includes('shanghai')} value="beijing">北京话 · 千问方言模型</option>
          <option disabled={!voice?.dialects?.includes('shanghai')} value="shanghai">上海话 · 千问方言模型{!voice?.dialects?.includes('shanghai') ? '（模型未就绪）' : ''}</option>
        </select>
      </label>
      <p className="dc-muted">语音在本机识别。方言和药名请核对原文；上海话模式可能需要更长时间。</p>
      <label className="dc-row" htmlFor="dc-cons-consent"><Checkbox checked={consent} id="dc-cons-consent" onCheckedChange={value => setConsent(value === true)} />{copy.consent}</label>
      <label className="dc-row" htmlFor="dc-cons-screen"><Checkbox checked={screenTogether} id="dc-cons-screen" onCheckedChange={value => setScreenTogether(value === true)} />{l.screenTogether}</label>
      {voicePreparing && <p className="dc-muted" role="status">{voice?.error || l.voicePreparing}</p>}
      <Button disabled={!patientId.trim() || !consent || state.status === 'starting' || voicePreparing} onClick={() => consultationAction({ type: 'start', patientId, patientName, consent, screen: screenTogether, dialect })}><Mic />{copy.start}</Button>
    </div> : <>
      <div className="dc-consult-controls">
        <Button onClick={onClose} variant="outline">{l.fillSuggestions}</Button>
        {state.status === 'recording' && <Button onClick={() => consultationAction({ type: 'pause' })} variant="outline"><Pause />{copy.pause}</Button>}
        {state.status === 'paused' && <Button disabled={state.pending > 0} onClick={() => consultationAction({ type: 'resume' })} variant="outline"><Play />{copy.resume}</Button>}
        {(active || state.status === 'failed') && <Button onClick={() => consultationAction({ type: 'finish' })}><StopFilled />{l.finalize}</Button>}
        {['ready', 'failed'].includes(state.status) && <Button disabled={state.dirty || state.pending > 0 || state.analyzing} onClick={() => {consultationAction({ type: 'reset' }); setConsent(false)}} variant="outline">{copy.newSession}</Button>}
        <Button disabled={!record?.transcript || state.analyzing} onClick={() => consultationAction({ type: 'analyze' })} variant="outline">{state.analyzing ? '正在整理病历与建议…' : '重新分析'}</Button>
      </div>
      {(state.analyzing || !!state.analysisProgress?.length || state.analysisError) && <details className="dc-analysis-progress" open={state.analyzing || !!state.analysisError}>
        <summary>{state.analyzing ? 'AI 正在处理 · 结果逐步更新' : state.analysisError ? '分析尚未完成' : '本次整理依据'}</summary>
        <div aria-live="polite" role="log">{state.analysisProgress?.map((line, index) => <p key={index}>{line}</p>)}</div>
        {state.analysisError && <p role="alert">{state.analysisError}</p>}
      </details>}
      <div className="dc-consult-grid"><section className="dc-consult-source"><h3>{copy.transcript}</h3>
        {!!record?.analysis_turns?.length && <section aria-label="医患角色分析" className="dc-role-turns"><p className="dc-muted">按问答内容推断角色，尚需核对；不代表声纹身份确认。下方保留原始转写，可校正角色与文字。</p>{record.analysis_turns.map((turn, index) => <p key={index}><strong>{turn.role} · {turn.role === '待确认' ? '信息不足' : 'AI 推断'}</strong><br />{turn.text}</p>)}</section>}
        <div aria-label="问诊转写" aria-live="polite" className="dc-transcript" role="log">{record?.transcript || <span className="dc-muted">{l.noTranscript}</span>}</div>
        {record?.transcript && <Button disabled={state.status === 'recording' || state.pending > 0 || state.analyzing} onClick={() => setCorrection({ text: record.transcript, count: record.segments?.length ?? 0 })} size="sm" variant="outline">校正转写{state.status === 'recording' ? '（请先暂停）' : ''}</Button>}
        {correction && <div><Textarea aria-label="校正问诊转写" onChange={event => setCorrection({ ...correction, text: event.target.value })} value={correction.text} /><div className="dc-consult-controls"><Button disabled={!correction.text.trim() || state.analyzing || state.pending > 0} onClick={() => {consultationAction({ type: 'correct', text: correction.text, segmentCount: correction.count }); setCorrection(null)}}>保存校正并重新分析</Button><Button onClick={() => setCorrection(null)} variant="ghost">取消</Button></div></div>}
        {active && <details><summary>{copy.markerNote}</summary><Input aria-label={copy.markerNote} onChange={event => setMarkerNote(event.target.value)} placeholder={copy.markerPlaceholder} value={markerNote} /><div className="dc-marker-buttons">{MARKERS.map(label => <Button key={label} onClick={() => {consultationAction({ type: 'marker', label, note: markerNote }); setMarkerNote('')}} size="sm" variant="outline"><Bookmark />{copy.markers[label]}</Button>)}</div></details>}
        {record?.marker_titles.map(marker => <p className="dc-muted" key={marker.id}>{marker.title} · {marker.note}</p>)}
      </section><section className="dc-consult-draft"><h3>{copy.draft}</h3><p className="dc-muted">{l.draftHelp}</p>
        {record?.analysis_mode === 'ai' && <details className="dc-structured-facts" open><summary>结构化病历 · 原文依据与分项复制</summary>{(record.draft_fields ?? []).filter(field => field.status === 'present').map(field => <article key={field.key}><div className="dc-row"><strong>{field.title}</strong><Button aria-label={`复制${field.title}`} onClick={() => {void navigator.clipboard.writeText(field.value).then(() => setNotice(`已复制${field.title}，请核对后粘贴。`), () => setNotice(l.copyError))}} size="sm" variant="ghost"><Copy />复制</Button></div><p>{field.value}</p><small className="dc-muted">依据：{field.source_evidence}</small></article>)}{(state.dirty || (record.doctor_draft_revision ?? 0) > 0) && <p className="dc-muted">以上是 AI 提取版本，最终采用下方医生编辑的草稿。</p>}</details>}
        <Textarea aria-label={copy.draft} onChange={event => consultationAction({ type: 'draft', text: event.target.value })} value={state.draft} />
        {!!record?.draft?.quality_issues.length && <details><summary>{copy.qualityIssues} · {record.draft.quality_issues.length}</summary><ul>{record.draft.quality_issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
        {!compact && draftActions}
        <p className="dc-muted">{state.analyzing ? '正在整理新增内容；您的手动修改会保留。' : '请核对转写与病历后再填写。AI 建议单独列出，不会自动写成已开医嘱。'}</p>
        <section className="dc-consult-suggestions"><h3>检查建议与待追问</h3>
          {record?.suggestions?.length ? record.suggestions.map((suggestion, index) => <article className="dc-analysis-progress" key={`${record.analysis_segments}-${index}`}>
            <strong>{suggestion.title}</strong><p>{suggestion.reason}</p><p className="dc-muted">问诊依据：{suggestion.evidence}</p>
            <Button onClick={() => {void navigator.clipboard.writeText(suggestion.title).then(() => setNotice('已复制所选建议，可粘贴到 HIS 对应输入框；请核对系统项目后提交。'), () => setNotice(l.copyError))}} size="sm" variant="outline"><Copy />选择并复制</Button>
          </article>) : <p className="dc-muted">{state.analyzing ? '正在结合问诊事实生成…' : '尚无可用建议，可补充问诊信息后重新分析。'}</p>}
        </section>
      </section></div>
      {compact && <footer className="dc-consult-actions">{draftActions}</footer>}
    </>}
  </section>
}

