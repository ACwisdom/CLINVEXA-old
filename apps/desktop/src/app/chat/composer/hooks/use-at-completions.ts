import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from '@assistant-ui/core'
import { useCallback, useMemo, useState } from 'react'

import { refChipLabel } from '@/components/assistant-ui/directive-text'
import { assistantMention } from '@/clinvexa/assistant-mentions'
import type { SummonedAssistant } from '@/clinvexa/summon'
import type { HermesGateway } from '@/hermes'
import { cachedPathCompletion, hasCachedPathCompletion } from '@/lib/slash-completion-cache'
import { normalize } from '@/lib/text'

import type { CompletionEntry, CompletionPayload } from './use-live-completion-adapter'
import { useLiveCompletionAdapter } from './use-live-completion-adapter'

const KIND_RE = /^@(file|folder|url|image|tool|git):(.*)$/
const REF_STARTERS = new Set(['file', 'folder', 'url', 'image', 'tool', 'git'])

const STARTER_META: Record<string, string> = {
  file: 'Attach a file reference',
  folder: 'Attach a folder reference',
  url: 'Attach a URL reference',
  image: 'Attach an image reference',
  tool: 'Attach a tool reference',
  git: 'Attach git context'
}

function starterEntries(query: string): CompletionEntry[] {
  const q = normalize(query)
  const kinds = Array.from(REF_STARTERS)
  const filtered = q ? kinds.filter(kind => kind.startsWith(q)) : kinds

  return filtered.map(kind => ({
    text: `@${kind}:`,
    display: `@${kind}:`,
    meta: STARTER_META[kind] || ''
  }))
}

interface AtItemMetadata extends Record<string, string> {
  icon: string
  display: string
  meta: string
  /** Raw `text` field from the gateway, e.g. `@file:src/main.tsx` or `@diff`. */
  rawText: string
  /** Just the value portion (after `@kind:`), or empty for simple refs. */
  insertId: string
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** Parse the gateway's `text` field (`@file:src/foo.ts`, `@diff`, `@folder:`) into popover-ready data. */
function classify(entry: CompletionEntry): {
  type: string
  insertId: string
  display: string
  meta: string
} {
  const match = KIND_RE.exec(entry.text)

  if (match) {
    const [, kind, rest] = match

    return {
      type: kind,
      insertId: rest,
      // The row shows exactly what picking it produces. Upstream keeps one
      // label per item and hands it to the chip verbatim (DirectiveNode's
      // `__label = item.label`); our wire format is `@kind:value`, which can't
      // carry a label the way their `:type[label]{name=id}` does, so the same
      // invariant is held by deriving both ends from refChipLabel. Without
      // this the list said `desktop/`, the editor said `apps/desktop/`, and
      // the chip said `desktop` — three names for one folder.
      display: rest ? refChipLabel(kind, rest) : textValue(entry.display, `@${kind}:`),
      meta: textValue(entry.meta)
    }
  }

  return {
    type: 'simple',
    insertId: entry.text,
    display: textValue(entry.display, entry.text),
    meta: textValue(entry.meta)
  }
}

/** Live `@` completions backed by the gateway's `complete.path` RPC. */
export function useAtCompletions(options: {
  gateway: HermesGateway | null
  sessionId: string | null
  cwd: string | null
  assistants?: readonly SummonedAssistant[]
  assistantStatus?: { local?: string; platform?: string }
}) {
  const [expanded, setExpanded] = useState<string[]>([])
  const { gateway, sessionId, cwd } = options
  const enabled = Boolean(gateway)

  // Cache key: the completion depends on the query AND the directory it's
  // resolved against, so a cwd or session change can't serve another tree's
  // listing.
  const cacheKey = useCallback((query: string) => `${cwd ?? ''}|${sessionId ?? ''}|${query}`, [cwd, sessionId])

  const fetcher = useCallback(
    async (query: string): Promise<CompletionPayload> => {
      const starters = starterEntries(query)

      if (!gateway) {
        return { items: starters, query }
      }

      const word = REF_STARTERS.has(query) ? `@${query}:` : `@${query}`
      const params: Record<string, unknown> = { word }

      if (sessionId) {
        params.session_id = sessionId
      }

      if (cwd) {
        params.cwd = cwd
      }

      try {
        // De-duplicated the same way `/` completions are. Walking a path is
        // inherently repetitive — Tab into a folder, Backspace out, retype a
        // segment — and every one of those steps used to be a fresh
        // `git ls-files` + rank on the backend (~40ms of the ~50ms round trip
        // measured on this repo's 8k files).
        const result = await cachedPathCompletion(cacheKey(query), () =>
          gateway.request<{ items?: CompletionEntry[] }>('complete.path', params)
        )

        const items = result.items ?? []

        return { items: items.length > 0 ? items : starters, query }
      } catch {
        return { items: starters, query }
      }
    },
    [cacheKey, gateway, sessionId, cwd]
  )

  const toItem = useCallback((entry: CompletionEntry, index: number): Unstable_TriggerItem => {
    const classified = classify(entry)

    const metadata: AtItemMetadata = {
      icon: classified.type,
      display: classified.display,
      meta: classified.meta,
      rawText: entry.text,
      insertId: classified.insertId
    }

    return {
      // Unique id keyed on the gateway's full `text` so two entries that share
      // a basename (e.g. multiple `index.ts`) don't collide in keyboard nav.
      id: `${entry.text}|${index}`,
      type: classified.type,
      label: classified.display,
      ...(classified.meta ? { description: classified.meta } : {}),
      metadata
    }
  }, [])

  // A query already in cache skips both the debounce and the loading state.
  // This is what makes walking a tree feel instant rather than merely fast:
  // the 60ms debounce exists to avoid a request per keystroke, and it buys
  // nothing when the answer is already in hand.
  const isCached = useCallback((query: string) => hasCachedPathCompletion(cacheKey(query)), [cacheKey])

  const live = useLiveCompletionAdapter({ enabled, fetcher, isCached, toItem })

  const adapter = useMemo<Unstable_TriggerAdapter>(
    () => ({
      ...live.adapter,
      search: query => {
        const q = normalize(query)
        const assistants = options.assistants ?? []

        // Plain @ is exclusively the assistant picker. Files require an explicit
        // @file: / @folder: scope, so a same-named document can never win Enter.
        if (
          options.assistants === undefined ||
          /^(?:diff|staged)$|^(?:file|folder|url|image|tool|git|line|terminal|session):/.test(q)
        ) {
          return live.adapter.search?.(query) ?? []
        }

        const mentions: Unstable_TriggerItem[] = []

        for (const source of ['platform', 'local'] as const) {
          const group = source === 'platform' ? '智能体' : '技能'

          const rows = assistants
            .filter(
              row =>
                row.source === source &&
                (!q || `${row.name} ${row.id} ${row.description}`.toLocaleLowerCase().includes(q))
            )
            .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))

          const visible = q || expanded.includes(source) ? rows : rows.slice(0, 4)
          mentions.push(
            ...visible.map(row => ({
              id: `assistant:${row.source}:${row.id}`,
              type: 'skill',
              label: `@${row.name}`,
              description: row.description,
              metadata: {
                rawText: assistantMention(row, assistants),
                insertId: '',
                display: `@${row.name}`,
                group,
                assistantId: row.id,
                assistantSource: row.source,
                meta: row.description
              }
            }))
          )

          if (!q && rows.length > 4) {
            const label = expanded.includes(source)
              ? `收起${group}`
              : `显示更多${group} · 还有 ${rows.length - 4} 个${group}`

            mentions.push({
              id: `expand:${source}`,
              type: 'skill',
              label,
              metadata: { group, display: label, expandGroup: source }
            })
          }

          if (!visible.length && !q) {
            const label = options.assistantStatus?.[source] || (q ? `没有匹配的${group}` : `暂无可调用的${group}`)
            mentions.push({
              id: `empty:${source}`,
              type: 'skill',
              label,
              metadata: { group, display: label, disabled: true }
            })
          }
        }

        return mentions
      }
    }),
    [live.adapter, options.assistants, options.assistantStatus, expanded]
  )

  const pickControl = (item: Unstable_TriggerItem) => {
    const meta = item.metadata as { expandGroup?: string; disabled?: boolean } | undefined

    if (meta?.disabled) {
      return true
    }

    if (!meta?.expandGroup) {
      return false
    }

    const group = meta.expandGroup
    setExpanded(current => (current.includes(group) ? current.filter(value => value !== group) : [...current, group]))

    return true
  }

  return { ...live, adapter, pickControl, reset: () => setExpanded([]) }
}

/** Re-export `classify` for use by the formatter (insertion side). */
export { classify }
