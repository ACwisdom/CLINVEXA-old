const CLINVEXA_SERVICE = 'http://127.0.0.1:8001'
const CONNECT_RETRY_MS = 400
const CONNECT_RETRIES = 8

export interface RpaRunResponse {
  failure_reason: string | null
  state: 'awaiting_confirmation' | 'stopped' | 'submitted'
  task_id: string
}

interface PrepareRpaTask {
  expected_patient_id: string
  expected_window_id: string
  fields: Record<string, string>
  task_id: string
}

interface ConfirmRpaTask {
  doctor_id: string
  patient_id: string
  window_id: string
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

  throw new Error(`CLINVEXA 本地服务暂不可用，请稍后重试。${lastError instanceof Error ? ` ${lastError.message}` : ''}`)
}

async function request(path: string, body: object): Promise<RpaRunResponse> {
  const response = await fetchWithRetry(`${CLINVEXA_SERVICE}${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })

  const payload = (await response.json().catch(() => null)) as (RpaRunResponse & { detail?: string }) | null

  if (!response.ok) {
    throw new Error(payload?.detail ?? `CLINVEXA service error: ${response.status}`)
  }

  if (!payload) {
    throw new Error('CLINVEXA service returned an empty response')
  }

  return payload
}

export function prepareRpaTask(task: PrepareRpaTask): Promise<RpaRunResponse> {
  return request('/clinvexa/rpa/tasks/prepare', task)
}

export function confirmRpaTask(taskId: string, confirmation: ConfirmRpaTask): Promise<RpaRunResponse> {
  return request(`/clinvexa/rpa/tasks/${encodeURIComponent(taskId)}/confirm`, confirmation)
}
