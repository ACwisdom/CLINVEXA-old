import { referenceRe } from '@/components/assistant-ui/reference-kinds'

import type { SummonedAssistant } from './summon'

const RESERVED = /^(?:diff$|staged$|(?:file|folder|url|image|tool|git|line|terminal|session):)/
const MENTION = /(^|\s)@(?:"([^"\n]+)"|([^\s@，。；！？,;!?]+))/g

export function assistantMention(assistant: SummonedAssistant, catalog: readonly SummonedAssistant[]): string {
  const duplicate =
    catalog.filter(row => row.name.toLocaleLowerCase() === assistant.name.toLocaleLowerCase()).length > 1
  const name =
    duplicate || /["@\r\n]/.test(assistant.name)
      ? `${assistant.source === 'local' ? 'skill' : 'agent'}:${assistant.id}`
      : assistant.name

  return /\s/.test(name) ? `@"${name}"` : `@${name}`
}

/** Resolve only explicit, boundary-delimited mentions; emails and file refs are not assistants. */
export function resolveAssistantMention(text: string, catalog: readonly SummonedAssistant[]) {
  let selected: SummonedAssistant | undefined
  let task = ''
  let end = 0
  const references = [...text.matchAll(referenceRe())].map(match => [match.index, match.index + match[0].length])

  for (const match of text.matchAll(MENTION)) {
    const name = match[2] || match[3]

    if (RESERVED.test(name) || references.some(([start, stop]) => match.index >= start && match.index < stop)) {
      continue
    }

    const matches = catalog.filter(row =>
      [row.name, row.id, `${row.source === 'local' ? 'skill' : 'agent'}:${row.id}`].some(
        alias => alias.toLocaleLowerCase() === name.toLocaleLowerCase()
      )
    )

    if (!matches.length) {
      if (!text.slice(0, match.index).trim() || /^(skill|agent):/.test(name)) {
        throw new Error(`未找到可调用的助手“${name}”。请从 @ 列表选择已安装并启用的技能或已绑定账号的智能体。`)
      }

      continue
    }

    if (matches.length > 1) {
      throw new Error(`存在同名助手“${name}”，请从 @ 列表选择具体助手。`)
    }
    const row = matches[0]

    if (selected && (selected.id !== row.id || selected.source !== row.source)) {
      throw new Error('一次消息请选择一位助手；完成后可在当前对话中 @ 另一位助手继续工作。')
    }

    selected = row
    task += text.slice(end, match.index) + match[1]
    end = match.index + match[0].length
  }

  return { assistant: selected, task: selected ? (task + text.slice(end)).trim() : text }
}

export function hasAssistantMention(text: string, catalog: readonly SummonedAssistant[]) {
  try {
    return Boolean(resolveAssistantMention(text, catalog).assistant)
  } catch {
    // Invalid explicit invocations must go through the normal, recoverable send path too.
    return true
  }
}
