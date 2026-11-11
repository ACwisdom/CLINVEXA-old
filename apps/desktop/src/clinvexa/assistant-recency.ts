import { persistStringRecord, storedStringRecord } from '@/lib/storage'

import type { SummonedAssistant } from './summon'

/** Old services have no installation timestamp. Remember additions after the
 * first successful inventory, scoped to the profile/account, across restarts. */
export function rememberAssistantAdditions(scope: string, rows: SummonedAssistant[]): SummonedAssistant[] {
  const key = `clinvexa:assistant-additions:${scope}`
  const previous = storedStringRecord(key)
  const next: Record<string, string> = { __initialized: '1' }
  const now = Date.now()

  const result = rows.map(row => {
    const remembered = Number(previous[row.id])
    const addedAt = row.addedAt || (Number.isFinite(remembered) ? remembered : previous.__initialized ? now : 0)
    next[row.id] = String(addedAt)

    return { ...row, addedAt }
  })

  persistStringRecord(key, next)

  return result
}
