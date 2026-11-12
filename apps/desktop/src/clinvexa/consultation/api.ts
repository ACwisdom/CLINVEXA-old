import type { ConsultationMarkerLabel, ConsultationResponse } from './types'
export type * from './types'

const CLINVEXA_SERVICE = 'http://127.0.0.1:8001'
const CONNECT_RETRY_MS = 400
const CONNECT_RETRIES = 8

export interface LiveVoiceStatus { installed: boolean; ready: boolean; error: string | null; dialects?: string[]; dialect_ready?: boolean }

export async function getLiveVoiceStatus(dialect = 'auto'): Promise<LiveVoiceStatus> {
  const response = await fetch(`${CLINVEXA_SERVICE}/clinvexa/voice/status?dialect=${encodeURIComponent(dialect)}`, { signal: AbortSignal.timeout(5000) })

  if (!response.ok) {throw new Error(`Voice readiness: ${response.status}`)}

  return response.json()
}

export async function prepareVoice(dialect: string): Promise<void> {
  const response = await fetch(`${CLINVEXA_SERVICE}/clinvexa/voice/warmup?dialect=${encodeURIComponent(dialect)}`, { method: 'POST', signal: AbortSignal.timeout(5000) })

  if (!response.ok) {throw new Error('方言模型准备失败，请重试')}
}

export async function requireVoiceReady(dialect: string): Promise<void> {
  const status = await getLiveVoiceStatus(dialect)

  if (!status.installed || !status.ready) {
    throw new Error(status.error || '本地语音模型尚未就绪，请等待准备完成后再开始录音')
  }
}

export const recoverConsultationAudio = (id: string): Promise<ConsultationResponse> => request(`/clinvexa/consultations/${encodeURIComponent(id)}/recover`, { method: 'POST', signal: AbortSignal.timeout(120000) })

async function request(path: string, init: RequestInit): Promise<ConsultationResponse> {
  return parseResponse(await fetch(`${CLINVEXA_SERVICE}${path}`, init))
}

export async function appendConsultationAudio(id: string, sequence: number, audio: Blob): Promise<ConsultationResponse> {
  return request(`/clinvexa/consultations/${encodeURIComponent(id)}/segments/${sequence}`, {
    method: 'POST', body: audio, headers: { 'content-type': 'audio/wav' }, signal: AbortSignal.timeout(20000)
  })
}

export async function completeConsultationStream(id: string, count: number, duration: number): Promise<ConsultationResponse> {
  return request(`/clinvexa/consultations/${encodeURIComponent(id)}/complete?segment_count=${count}&duration_ms=${Math.max(1, duration)}`, { method: 'POST', signal: AbortSignal.timeout(10000) })
}

interface StartConsultationRequest {
  dialect?: string
  consent_confirmed: boolean
  patient_id: string
  patient_name: string
}

export interface AnalysisEvent {
  type: 'progress' | 'field' | 'suggestion' | 'utterance' | 'done' | 'error'
  message?: string
  key?: string
  value?: string
  title?: string
  evidence?: string
  record?: ConsultationResponse
}

export async function analyzeConsultation(id: string, onEvent: (event: AnalysisEvent) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${CLINVEXA_SERVICE}/clinvexa/consultations/${encodeURIComponent(id)}/analysis`, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(55000)])
  })

  if (!response.ok || !response.body) {throw new Error('AI 分析服务未就绪，请重试')}
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false

  const consume = (line: string) => {
    if (!line.trim()) {return}
    const event = JSON.parse(line) as AnalysisEvent
    terminal ||= event.type === 'done' || event.type === 'error'
    onEvent(event)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n'); buffer = lines.pop() ?? ''

      for (const line of lines) {consume(line)}

      if (done) {consume(buffer);

 break}
    }

    if (!terminal) {throw new Error('分析连接中断，已保留转写，请重新分析')}
  } finally {reader.releaseLock()}
}

interface AddMarkerRequest {
  label: ConsultationMarkerLabel
  note: string
  offset_ms: number
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= CONNECT_RETRIES; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error

      if (attempt < CONNECT_RETRIES) {
        await delay(CONNECT_RETRY_MS)
      }
    }
  }

  throw new Error(`CLINVEXA 本地服务暂不可用。${lastError instanceof Error ? ` ${lastError.message}` : ''}`)
}

async function parseResponse(response: Response): Promise<ConsultationResponse> {
  const payload = (await response.json().catch(() => null)) as (ConsultationResponse & { detail?: string }) | null

  if (!response.ok) {
    throw new Error(payload?.detail ?? `CLINVEXA service error: ${response.status}`)
  }

  if (!payload) {
    throw new Error('CLINVEXA service returned an empty response')
  }

  return payload
}

async function jsonRequest(path: string, body: object): Promise<ConsultationResponse> {
  return parseResponse(
    await fetchWithRetry(`${CLINVEXA_SERVICE}${path}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
  )
}

export function startConsultation(body: StartConsultationRequest): Promise<ConsultationResponse> {
  return jsonRequest('/clinvexa/consultations', body)
}

export const getConsultation = (id: string): Promise<ConsultationResponse> => request(`/clinvexa/consultations/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) })
export const correctTranscript = (id: string, text: string, segmentCount: number): Promise<ConsultationResponse> => request(`/clinvexa/consultations/${encodeURIComponent(id)}/transcript`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, segment_count: segmentCount }), signal: AbortSignal.timeout(10000) })
export const saveConsultationDraft = (id: string, draft: string, revision: number): Promise<ConsultationResponse> => request(`/clinvexa/consultations/${encodeURIComponent(id)}/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft, revision }), signal: AbortSignal.timeout(10000) })

export async function recentConsultations(): Promise<Array<Pick<ConsultationResponse, 'id' | 'patient_id' | 'patient_name' | 'started_at' | 'status'>>> {
  const response = await fetch(`${CLINVEXA_SERVICE}/clinvexa/consultations`, { signal: AbortSignal.timeout(10000) })

  if (!response.ok) {throw new Error('无法读取问诊历史，请重试')}

  return response.json()
}

export function addConsultationMarker(
  consultationId: string,
  body: AddMarkerRequest
): Promise<ConsultationResponse> {
  return jsonRequest(`/clinvexa/consultations/${encodeURIComponent(consultationId)}/markers`, body)
}

export async function finishConsultation(
  consultationId: string,
  audio: Blob,
  durationMs: number
): Promise<ConsultationResponse> {
  const response = await fetchWithRetry(
    `${CLINVEXA_SERVICE}/clinvexa/consultations/${encodeURIComponent(consultationId)}/finish?duration_ms=${Math.max(1, Math.round(durationMs))}`,
    {
      body: audio,
      headers: { 'content-type': audio.type || 'audio/webm' },
      method: 'POST'
    }
  )

  return parseResponse(response)
}
