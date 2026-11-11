import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { type ConsultationResponse } from './api'
import { $consultation, consultationAction, ownConsultation } from './live-session'

import { CLINVEXAConsultation } from '.'

const mic = vi.hoisted(() => ({
  emit: null as null | ((audio: Blob) => void),
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(async () => {}), cancel: vi.fn(),
}))

vi.mock('./pcm-recorder', () => ({ ConsultationPCMRecorder: class {
  start = async (emit: (audio: Blob) => void) => {mic.emit = emit; mic.start()}
  pause = mic.pause; resume = mic.resume; stop = mic.stop; cancel = mic.cancel
} }))

function record(patch: Partial<ConsultationResponse> = {}): ConsultationResponse {
  return { audio_path: null, consent_confirmed: true, draft: null, draft_text: '', duration_ms: 0,
    ended_at: null, error: null, id: 'b'.repeat(32), marker_titles: [], markers: [], patient_id: 'SYNTH-01',
    patient_name: '合成患者', started_at: '2026-09-14T10:00:00+08:00', status: 'recording', transcript: '',
    segments: [], doctor_draft_revision: 0, ...patch } as ConsultationResponse
}

let release: () => void
beforeEach(() => {
  release = ownConsultation()
  $consultation.set({ status: 'ready', record: null, draft: '', elapsed: 0, pending: 0, error: null, dirty: false })
  consultationAction({ type: 'reset' })
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  $consultation.set({ ...$consultation.get(), status: 'ready', dirty: false })
  consultationAction({ type: 'reset' })
  release(); vi.unstubAllGlobals()
})

function mount(onSend = vi.fn()) {
  return { onSend, ...render(<I18nProvider configClient={null} initialLocale="zh"><CLINVEXAConsultation onClose={vi.fn()} onSendToMedicalAgent={onSend} /></I18nProvider>) }
}

async function start() {
  fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'SYNTH-01' } })
  fireEvent.click(screen.getByLabelText('患者已知情并同意本次问诊记录。'))
  await waitFor(() => expect(screen.getByRole('button', { name: '开始问诊记录' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '开始问诊记录' }))
  await waitFor(() => expect(mic.start).toHaveBeenCalledOnce())
}

describe('continuous consultation workflow', () => {
  it('opens a requested saved consultation without starting the microphone', async () => {
    const saved = record({ id: 'historical-voice', status: 'ready', draft_text: '历史病历草稿', transcript: '历史问诊内容' })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/voice/')) return Response.json({ installed: true, ready: true, error: null })
      return Response.json(url.endsWith('/historical-voice') ? saved : [])
    }))
    render(<I18nProvider configClient={null} initialLocale="zh"><CLINVEXAConsultation requestedRecordId="historical-voice" onClose={vi.fn()} onSendToMedicalAgent={vi.fn()} /></I18nProvider>)
    await waitFor(() => expect($consultation.get().record?.id).toBe('historical-voice'))
    expect((screen.getByLabelText('病历草稿') as HTMLTextAreaElement).value).toBe('历史病历草稿')
    expect(mic.start).not.toHaveBeenCalled()
  })

  it('keeps the last clicked consultation when earlier loading finishes late', async () => {
    const pending = new Map<string, (value: Response) => void>()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => new Promise<Response>(resolve => pending.set(String(input).split('/').pop()!, resolve))))
    consultationAction({ type: 'load', id: 'first' })
    consultationAction({ type: 'load', id: 'second' })
    await act(async () => pending.get('second')!(Response.json(record({ id: 'second', status: 'ready' }))))
    await waitFor(() => expect($consultation.get().record?.id).toBe('second'))
    await act(async () => pending.get('first')!(Response.json(record({ id: 'first', status: 'ready' }))))
    expect($consultation.get().record?.id).toBe('second')
  })
  it('keeps recording through transcription failures and backlog until the doctor stops', async () => {
    let available = false
    let saved = record()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/voice/')) {return Response.json({ installed: true, ready: true, error: null })}

      if (!init?.method) {return Response.json([])}

      if (url.includes('/segments/')) {
        if (!available) {throw new Error('temporary offline')}
        saved = record({ ...saved, transcript: '患者：腹痛三天。', segments: [...(saved.segments ?? []), { sequence: saved.segments?.length ?? 0, text: '腹痛', duration_ms: 1000 }] })
      }

      if (url.endsWith('/analysis')) {return new Response(JSON.stringify({ type: 'error', message: '模型暂不可用' }) + '\n')}

      if (url.includes('/complete?')) {saved = record({ ...saved, status: 'ready' })}

      return Response.json(saved)
    }))
    mount(); await start()
    act(() => {for (let i = 0; i < 16; i++) {mic.emit?.(new Blob(['audio']))}})
    await waitFor(() => expect($consultation.get().error).toContain('转写暂时延迟'))
    expect($consultation.get().status).toBe('recording')
    expect($consultation.get().pending).toBe(16)
    expect(mic.pause).not.toHaveBeenCalled()
    expect(mic.stop).not.toHaveBeenCalled()
    available = true
    act(() => consultationAction({ type: 'retry' }))
    await waitFor(() => expect($consultation.get().pending).toBe(0))
    await waitFor(() => expect($consultation.get().analyzing).toBe(false))
    expect($consultation.get().status).toBe('recording')
    expect(mic.stop).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '结束并核对草稿' }))
    await waitFor(() => expect($consultation.get().status).toBe('ready'))
    expect(mic.stop).toHaveBeenCalledOnce()
  })
  it('reads history without opening the microphone before explicit consent and start', async () => {
    const fetchMock = vi.fn(async () => Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    mount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(mic.start).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '开始问诊记录' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'SYNTH-01' } })
    expect(screen.getByRole('button', { name: '开始问诊记录' }).hasAttribute('disabled')).toBe(true)
  })

  it('renders speech before stopping, survives navigation, and preserves saved physician edits', async () => {
    let saved = record()

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/voice/')) {return Response.json({ installed: true, ready: true, error: null })}

      if (!init?.method || init.method === 'GET') {return Response.json([])}

      if (url.endsWith('/analysis')) {return new Response(JSON.stringify({ type: 'done', record: { ...saved, analysis_mode: 'ai', analysis_segments: saved.segments?.length } }) + '\n')}

      if (url.includes('/segments/')) {
        saved = record({ ...saved, transcript: '患者：咳嗽三天。', draft_text: saved.doctor_draft ?? '主诉：咳嗽3天。', segments: [{ sequence: 0 }] as ConsultationResponse['segments'] })
      } else if (url.endsWith('/draft')) {
        const body = JSON.parse(String(init.body))
        saved = record({ ...saved, doctor_draft: body.draft, doctor_draft_revision: body.revision + 1, draft_text: body.draft })
      } else if (url.includes('/complete?')) {saved = record({ ...saved, status: 'ready' })}

      return Response.json(saved)
    })

    vi.stubGlobal('fetch', fetchMock)
    const first = mount()
    await start()
    act(() => mic.emit?.(new Blob(['wav-packet'])))
    await waitFor(() => expect(screen.getByRole('log', { name: '问诊转写' }).textContent).toContain('咳嗽三天'))
    expect(mic.stop).not.toHaveBeenCalled()
    first.unmount()
    expect(mic.cancel).not.toHaveBeenCalled()
    const second = mount()
    expect(screen.getByRole('log', { name: '问诊转写' }).textContent).toContain('咳嗽三天')
    fireEvent.change(screen.getByLabelText('病历草稿'), { target: { value: '医生已核对并修改。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(saved.doctor_draft).toBe('医生已核对并修改。'))
    fireEvent.click(screen.getByRole('button', { name: '结束并核对草稿' }))
    await waitFor(() => expect($consultation.get().status).toBe('ready'))
    expect((screen.getByLabelText('病历草稿') as HTMLTextAreaElement).value).toBe('医生已核对并修改。')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/finish?'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '交给医疗智能体' }))
    expect(second.onSend).toHaveBeenCalledWith(expect.stringContaining('医生已核对并修改。'))
  })

  it('blocks recording when the installed decoder is missing, including direct commands', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/voice/')
      ? Response.json({ installed: false, ready: false, error: '本地语音识别运行库缺失' }) : Response.json([])))
    mount()
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'SYNTH-01' } })
    fireEvent.click(screen.getByLabelText('患者已知情并同意本次问诊记录。'))
    await waitFor(() => expect(screen.getByText('本地语音识别运行库缺失')).toBeTruthy())
    expect(screen.getByRole('button', { name: '开始问诊记录' }).hasAttribute('disabled')).toBe(true)
    act(() => consultationAction({ type: 'start', patientId: 'SYNTH-01', patientName: '', consent: true }))
    await waitFor(() => expect($consultation.get().error).toContain('运行库缺失'))
    expect(mic.start).not.toHaveBeenCalled()
    expect($consultation.get().record).toBeNull()
  })
})
