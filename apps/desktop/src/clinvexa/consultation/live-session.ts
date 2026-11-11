import type { ConsultationCommand, ConsultationView } from './types'
export type { ConsultationCommand, ConsultationView } from './types'

import { atom } from 'nanostores'

import { addConsultationMarker, analyzeConsultation, appendConsultationAudio, completeConsultationStream, correctTranscript, getConsultation, recoverConsultationAudio, requireVoiceReady, saveConsultationDraft, startConsultation } from './api'
import { ConsultationPCMRecorder } from './pcm-recorder'

const initial = (): ConsultationView => ({ status: 'setup', record: null, draft: '', elapsed: 0, pending: 0, error: null, dirty: false })
export const $consultation = atom<ConsultationView>(initial())
let owner = false
let recorder = new ConsultationPCMRecorder()
let queue: Array<{ sequence: number; audio: Blob }> = []
let sequence = 0
let pumping: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | undefined
let resumeAt = 0
let accrued = 0
let edited = false
let stopped = false
let analysis: Promise<void> | null = null
let analysisAbort = new AbortController()
let analysisRequested = false
let lastAnalysisText = ''
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryFailures = 0
let retryBlocked = false
let historyLoadRequest = 0

export function canLoadConsultation(state: ConsultationView): boolean {
  return (['setup', 'ready'].includes(state.status) || (state.status === 'failed' && stopped && !queue.length)) && !state.dirty && !state.analyzing && !state.pending
}

async function analyze(): Promise<void> {
  analysisRequested = true

  if (analysis) {return analysis}
  const sessionId = $consultation.get().record?.id

  if (!sessionId) {return}
  analysis = (async () => {
    while (analysisRequested && $consultation.get().record?.id === sessionId) {
      analysisRequested = false
      const snapshot = $consultation.get().record!

      if (!snapshot.transcript) {break}

      if (snapshot.transcript === lastAnalysisText && snapshot.analysis_mode === 'ai') {break}
      lastAnalysisText = snapshot.transcript
      update({ analyzing: true, analysisError: null, analysisProgress: [] })

      try {
        await analyzeConsultation(sessionId, event => {
          const current = $consultation.get()

          if (current.record?.id !== sessionId) {return}

          if (event.type === 'done' && event.record) {
            const record = { ...current.record, draft: event.record.draft, draft_text: event.record.draft_text,
              draft_fields: event.record.draft_fields, analysis_mode: event.record.analysis_mode,
              analysis_segments: event.record.analysis_segments, suggestions: event.record.suggestions,
              analysis_turns: event.record.analysis_turns,
              analysis_warning: event.record.analysis_warning }

            update({ record, ...(!edited ? { draft: record.draft_text } : {}) })
          } else if (event.type === 'error') {
            update({ analysisError: event.message || '分析未完成，请重试' })
          } else {
            const message = event.type === 'field' ? `已提取：${event.value}` : event.type === 'suggestion' ? `待医生核对：${event.title}` : event.message

            if (message) {update({ analysisProgress: [...(current.analysisProgress ?? []), message].slice(-14) })}
          }
        }, analysisAbort.signal)
      } catch (error) {
        if (!analysisAbort.signal.aborted) {update({ analysisError: String(error) })}
      }
    }
  })().finally(() => {analysis = null;

 if ($consultation.get().record?.id === sessionId) {update({ analyzing: false })}})

  return analysis
}

function update(patch: Partial<ConsultationView>): void {
  $consultation.set({ ...$consultation.get(), ...patch })
  window.hermesDesktop?.CLINVEXAWindow?.publishConsultation?.($consultation.get())
}

function elapsed(): number {return accrued + (resumeAt ? Date.now() - resumeAt : 0)}

function pauseClock(): void {accrued = elapsed(); resumeAt = 0; update({ elapsed: accrued })}

async function pump(): Promise<void> {
  if (retryBlocked) {return}
  if (pumping) {return pumping}
  pumping = (async () => {
    while (queue.length) {
      const item = queue[0]
      const id = $consultation.get().record?.id

      if (!id) {break}

      try {
        let record = await appendConsultationAudio(id, item.sequence, item.audio)
        const current = $consultation.get().record

        if (current?.id === id && (current.analysis_segments ?? 0) > (record.analysis_segments ?? 0)) {
          record = { ...record, draft: current.draft, draft_text: current.draft_text, draft_fields: current.draft_fields,
            analysis_turns: current.analysis_turns,
            analysis_segments: current.analysis_segments, analysis_mode: current.analysis_mode, suggestions: current.suggestions }
        }

        queue.shift()
        retryFailures = 0
        update({ record, pending: queue.length, error: null, ...(!edited ? { draft: record.draft_text } : {}) })

        if (record.transcript) {void analyze()}
      } catch (error) {
        // Transcription/network failures must not control microphone capture.
        // Keep ordered packets until committed, retry independently of analysis.
        retryFailures += 1
        const permanent = /缺失|不完整|未安装|未就绪|内容不一致|顺序不连续/.test(String(error))
        retryBlocked = permanent || retryFailures >= 3
        update({ error: `${retryBlocked ? '转写未恢复，请修复下方问题后点击重试；录音仍在继续，请勿关闭应用。' : '转写暂时延迟，将自动重试。'}${String(error)}`, pending: queue.length })
        clearTimeout(retryTimer)

        if (!stopped && !retryBlocked) {retryTimer = setTimeout(() => {void pump()}, 3000)}

        break
      }
    }
  })().finally(() => {pumping = null})

  return pumping
}

async function execute(command: ConsultationCommand): Promise<void> {
  const state = $consultation.get()

  if (command.type === 'start') {
    if (state.status !== 'setup' || !command.patientId.trim() || !command.consent) {return}
    update({ status: 'starting', error: null })

    try {
      await requireVoiceReady(command.dialect ?? 'auto')
      const record = await startConsultation({ patient_id: command.patientId.trim(), patient_name: command.patientName.trim(), consent_confirmed: true, dialect: command.dialect ?? 'auto' })
      analysisAbort = new AbortController()
      update({ record })
      stopped = false; sequence = 0; queue = []; edited = false; accrued = 0; lastAnalysisText = ''; retryBlocked = false; retryFailures = 0
      recorder = new ConsultationPCMRecorder()
      await recorder.start(audio => {
        queue.push({ sequence: sequence++, audio })
        update({ pending: queue.length })

        void pump()
      }, error => {
        recorder.cancel(); stopped = true; pauseClock(); update({ status: 'failed', error: error.message })
      })
      resumeAt = Date.now()
      timer = setInterval(() => update({ elapsed: elapsed() }), 1000)
      update({ status: 'recording' })

      if (command.screen) {
        try {await window.hermesDesktop?.CLINVEXACopilot?.setEnabled(true)}
        catch (error) {update({ error: String(error) })}
      }
    } catch (error) {recorder.cancel(); update({ status: 'setup', error: String(error) })}

    return
  }

  if (command.type === 'draft') {edited = true; update({ draft: command.text, dirty: true });

 return}

  if (command.type === 'analyze') {lastAnalysisText = ''; await analyze();

 return}

  if (command.type === 'save' && state.record) {
    try {
      const saved = await saveConsultationDraft(state.record.id, state.draft, state.record.doctor_draft_revision ?? 0)
      update({ record: { ...$consultation.get().record!, doctor_draft: saved.doctor_draft, doctor_draft_revision: saved.doctor_draft_revision }, dirty: $consultation.get().draft !== state.draft, error: null })
    } catch (error) {update({ error: String(error) })}

    return
  }

  if (command.type === 'correct' && state.record && !state.analyzing && !state.pending && state.status !== 'recording') {
    try {
      const record = await correctTranscript(state.record.id, command.text, command.segmentCount)
      update({ record, error: null }); lastAnalysisText = ''; await analyze()
    } catch (error) {update({ error: String(error) })}

    return
  }

  if (command.type === 'load' && canLoadConsultation(state)) {
    const request = ++historyLoadRequest
    try {
      const record = await getConsultation(command.id)
      if (request !== historyLoadRequest || $consultation.get() !== state) return
      edited = (record.doctor_draft_revision ?? 0) > 0
      sequence = record.segments?.length ?? 0; queue = []; stopped = true; accrued = record.duration_ms; resumeAt = 0
      lastAnalysisText = ''
      update({ record, draft: record.draft_text, analysisProgress: [], analysisError: null, status: record.status === 'ready' ? 'ready' : 'failed', elapsed: accrued, pending: 0, error: record.status === 'ready' ? null : '这是中断的历史问诊。点击重试恢复已保存的录音分段，核对后结束问诊。' })
    } catch (error) {if (request === historyLoadRequest && $consultation.get() === state) update({ error: String(error) })}

    return
  }

  if (command.type === 'pause' && state.status === 'recording') {
    recorder.pause(); pauseClock(); update({ status: 'paused' });

 return
  }

  if (command.type === 'resume' && state.status === 'paused' && !state.pending && !stopped) {
    recorder.resume(); resumeAt = Date.now(); update({ status: 'recording', error: null });

 return
  }

  if (command.type === 'retry') {
    retryBlocked = false; retryFailures = 0
    if (queue.length) {await pump()}
    else if (state.record && state.status === 'failed') {
      try {
        const record = await recoverConsultationAudio(state.record.id)
        sequence = record.segments?.length ?? 0; accrued = record.duration_ms
        update({ record, elapsed: accrued, error: null, ...(!edited ? { draft: record.draft_text } : {}) })
        if (record.transcript) {await analyze()}
      } catch (error) {update({ error: String(error) })}
    }

 return}

  if (command.type === 'marker' && state.record && ['recording', 'paused'].includes(state.status)) {
    try {
      const record = await addConsultationMarker(state.record.id, { label: command.label, note: command.note, offset_ms: elapsed() })
      // Do not roll back transcript when an ASR response arrives ahead of a marker response.
      update({ record: { ...$consultation.get().record!, markers: record.markers, marker_titles: record.marker_titles } })
    } catch (error) {update({ error: String(error) })}

    return
  }

  if (command.type === 'finish' && state.record && ['recording', 'paused', 'failed'].includes(state.status)) {
    clearTimeout(retryTimer)
    update({ status: 'processing', error: null }); pauseClock(); clearInterval(timer)

    try {
      if (!stopped) {await recorder.stop(); stopped = true}
      retryBlocked = false; retryFailures = 0
      await pump()

      if (queue.length) {throw new Error('仍有分段等待恢复，请点击重试，完成后再次结束问诊。')}
      const record = await completeConsultationStream(state.record.id, sequence, accrued)
      update({ status: 'ready', record, ...(!edited ? { draft: record.draft_text } : {}) })

      if ((record.analysis_segments ?? 0) < sequence || record.analysis_mode !== 'ai') {await analyze()}
    } catch (error) {update({ status: 'failed', error: String(error) })}

    return
  }

  if (command.type === 'reset' && ['ready', 'failed'].includes(state.status) && !state.dirty && !queue.length && !state.analyzing) {
    clearTimeout(retryTimer)
    recorder.cancel(); clearInterval(timer); queue = []; edited = false; update(initial())
  }
}

export function consultationAction(command: ConsultationCommand): void {
  if (owner) {void execute(command)}
  else {window.hermesDesktop?.CLINVEXAWindow?.commandConsultation?.(command)}
}

/** The main renderer owns capture; hiding a panel never destroys its session. */
export function ownConsultation(): () => void {
  owner = true
  const stop = window.hermesDesktop?.CLINVEXAWindow?.onConsultationCommand?.(command => {void execute(command)})
  update({})

  return () => {stop?.(); owner = false}
}

export function mirrorConsultation(): () => void {
  const bridge = window.hermesDesktop?.CLINVEXAWindow
  let active = true
  let receivedUpdate = false

  const stop = bridge?.onConsultationState?.(state => {
    receivedUpdate = true

    if (active) {$consultation.set(state)}
  })

  void bridge?.getConsultationState?.().then(state => {if (active && !receivedUpdate && state) {$consultation.set(state)}}).catch(() => {})

  return () => {active = false; stop?.()}
}
