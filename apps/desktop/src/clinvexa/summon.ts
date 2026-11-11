import { atom } from 'nanostores'

export interface SummonedAssistant {
  id: string
  name: string
  description: string
  source: 'local' | 'platform'
  account?: string
  addedAt?: number
}

// Ephemeral bindings belong to a conversation, never to the global composer.
// Both identities are retained because resume/compression changes runtime IDs.
export const $summonedAssistants = atom<Record<string, SummonedAssistant>>({})

export function bindAssistant(assistant: SummonedAssistant, ids: string[]) {
  const next = { ...$summonedAssistants.get() }

  for (const id of ids.filter(Boolean)) {
    next[id] = assistant
  }

  $summonedAssistants.set(next)
}

export function removeAssistant(assistant: SummonedAssistant) {
  $summonedAssistants.set(
    Object.fromEntries(Object.entries($summonedAssistants.get()).filter(([, item]) => item !== assistant))
  )
}

export async function prepareAssistant(assistant: SummonedAssistant, text: string): Promise<string> {
  if (assistant.source === 'platform') {
    if (!window.hermesDesktop?.api) {
      throw new Error('CLINVEXA 后台尚未连接')
    }

    const result = await window.hermesDesktop.api<{ invocation: string }>({
      path: '/api/clinvexa/platform/prepare',
      method: 'POST',
      timeoutMs: 45000,
      body: { installation_id: assistant.id, account_id: assistant.account, text }
    })

    if (typeof result.invocation !== 'string' || !result.invocation.trim()) {
      throw new Error('智能体未返回有效的调用内容，请重新同步后重试')
    }

    return result.invocation
  }

  const response = await fetch(`http://127.0.0.1:8001/clinvexa/skills/${encodeURIComponent(assistant.id)}/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ task: text, source_paths: [] }),
    signal: AbortSignal.timeout(15000)
  })

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result.detail || '本机技能暂不可用，请重新安装或启用后重试')
  }

  if (typeof result.invocation !== 'string' || !result.invocation.trim()) {
    throw new Error('技能未返回有效的调用内容')
  }

  return result.invocation
}
