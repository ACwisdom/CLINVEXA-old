import CLINVEXACatalog from '../../../../../skills/clinvexa/catalog.json'
import { localizedExternalTitle, localizedSkillDescription } from '@/app/skills/capability-localization'

const CLINVEXA_SERVICE = 'http://127.0.0.1:8001'
const CONNECT_RETRY_MS = 400

export type CLINVEXASkillScope = 'department' | 'personal' | 'platform'

export interface CLINVEXAPlazaSkill {
  added_at?: number | null
  default_version: string
  dependencies: string[]
  description: string
  enabled: boolean
  offline?: boolean
  installed: boolean
  name: string
  scope: CLINVEXASkillScope
  title: string
  version: string | null
  versions: string[]
}

interface EmbeddedCatalogSkill {
  default_version: string
  dependencies: string[]
  description: string
  name: string
  scope: CLINVEXASkillScope
  title: string
  versions: string[]
}

interface InstalledSkillResponse {
  enabled: boolean
  name: string
  version: string
}

export type SkillInvokeResponse =
  | { invocation: string; mode: 'agent' }
  | { message: string; mode: 'deterministic'; output_paths: string[]; processed_sources: number }

export type CLINVEXASkillStreamEvent =
  | { event_id: string; message: string; stage: string; status: 'running' | 'complete'; type: 'progress' }
  | { extraction_summary: Record<string, unknown>; mode: 'deterministic'; output_paths: string[]; processed_sources: number; result_markdown: string; type: 'complete' }
  | { invocation: string; mode: 'agent'; type: 'agent' }
  | { message: string; type: 'error' }

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown = null

  const retries = !init?.method || init.method === 'GET' ? 2 : 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(retries ? 2000 : 120000) })
    } catch (error) {
      lastError = error

      if (attempt < retries) {
        await delay(CONNECT_RETRY_MS)
      }
    }
  }

  throw new Error(`CLINVEXA 本地服务暂不可用，请稍后重试。${lastError instanceof Error ? ` ${lastError.message}` : ''}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithRetry(`${CLINVEXA_SERVICE}${path}`, init)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail ?? `CLINVEXA service error: ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/**
 * Return the live Skill state when the local service is available. If the
 * service is restarting, keep the plaza useful by showing the exact catalog
 * bundled into this build. Mutating actions stay disabled for offline rows.
 */
export async function listCLINVEXASkills(): Promise<CLINVEXAPlazaSkill[]> {
  const display = (skill: CLINVEXAPlazaSkill): CLINVEXAPlazaSkill => ({
    ...skill,
    title: /[\u3400-\u9fff]/u.test(skill.title) ? skill.title.replace(/\bSkill\b/gi, '技能') : localizedExternalTitle(skill.name, 'zh'),
    description: /[\u3400-\u9fff]/u.test(skill.description) ? skill.description.replace(/\bSkill\b/gi, '技能') : localizedSkillDescription({ name: skill.name, description: skill.description, category: 'CLINVEXA', enabled: skill.enabled }, 'zh')
  })
  try {
    return (await request<CLINVEXAPlazaSkill[]>('/clinvexa/skills')).map(display)
  } catch {
    return (CLINVEXACatalog.skills as EmbeddedCatalogSkill[]).map(skill => ({
      default_version: skill.default_version,
      dependencies: skill.dependencies,
      description: skill.description,
      enabled: false,
      installed: false,
      name: skill.name,
      offline: true,
      scope: skill.scope,
      title: skill.title,
      version: null,
      versions: skill.versions
    })).map(display)
  }
}

export function installCLINVEXASkill(name: string, version: string): Promise<InstalledSkillResponse> {
  return request(`/clinvexa/skills/${encodeURIComponent(name)}/install`, {
    body: JSON.stringify({ version }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
}

export function setCLINVEXASkillEnabled(name: string, enabled: boolean): Promise<InstalledSkillResponse> {
  return request(`/clinvexa/skills/${encodeURIComponent(name)}/enabled`, {
    body: JSON.stringify({ enabled }),
    headers: { 'content-type': 'application/json' },
    method: 'PUT'
  })
}

export function switchCLINVEXASkillVersion(name: string, version: string): Promise<InstalledSkillResponse> {
  return request(`/clinvexa/skills/${encodeURIComponent(name)}/version`, {
    body: JSON.stringify({ version }),
    headers: { 'content-type': 'application/json' },
    method: 'PUT'
  })
}

export function uninstallCLINVEXASkill(name: string): Promise<void> {
  return request(`/clinvexa/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export function invokeCLINVEXASkill(name: string, task: string, sourcePaths: string[] = []): Promise<SkillInvokeResponse> {
  return request(`/clinvexa/skills/${encodeURIComponent(name)}/invoke`, {
    body: JSON.stringify({ source_paths: sourcePaths, task }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
}

export async function streamCLINVEXASkill(
  name: string,
  task: string,
  sourcePaths: string[],
  onEvent: (event: CLINVEXASkillStreamEvent) => Promise<void> | void
): Promise<void> {
  const response = await fetchWithRetry(
    `${CLINVEXA_SERVICE}/clinvexa/skills/${encodeURIComponent(name)}/invoke/stream`,
    {
      body: JSON.stringify({ source_paths: sourcePaths, task }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    }
  )

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(payload?.detail ?? `CLINVEXA service error: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('CLINVEXA 未返回 Skill 处理过程')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false

  const emit = async (event: CLINVEXASkillStreamEvent) => {
    if (event.type === 'complete' || event.type === 'error' || event.type === 'agent') {terminal = true}
    await onEvent(event)
  }

  try {
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim()) {
        const event = JSON.parse(line) as CLINVEXASkillStreamEvent
        await emit(event)
      }
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    await emit(JSON.parse(buffer) as CLINVEXASkillStreamEvent)
  }

  if (!terminal) {throw new Error('Skill 连接中断，尚未收到完成结果。已收到的内容仍保留，请检查任务状态后重试。')}
  } finally {reader.releaseLock()}
}
