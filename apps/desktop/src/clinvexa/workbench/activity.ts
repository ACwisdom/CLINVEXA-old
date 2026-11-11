import { type ChatMessage, type ChatMessagePart, chatMessageText } from '@/lib/chat-messages'

import type { CLINVEXAAgentActivity, CLINVEXAAgentId } from '.'

const CLINVEXA_MARKER = '[CLINVEXA V1 任务]'
const AGENT_IDS = new Set<CLINVEXAAgentId>(['orchestrator', 'medical_record', 'knowledge_patient', 'desktop_his'])

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool-call' }>

function toolCalls(message: ChatMessage): ToolCallPart[] {
  return message.parts.filter((part): part is ToolCallPart => part.type === 'tool-call')
}

function parseAgentId(prompt: string): CLINVEXAAgentId | null {
  const candidate = prompt.match(/目标 Agent：([^\s]+)/)?.[1]

  return candidate && AGENT_IDS.has(candidate as CLINVEXAAgentId) ? (candidate as CLINVEXAAgentId) : null
}

function sourceReferences(text: string): string[] {
  const sources: string[] = []

  for (const match of text.matchAll(/(?:^|\n)来源[：:]\s*([^\n]+)/g)) {
    for (const source of match[1].split(/[；;,，]/)) {
      const normalized = source.trim()

      if (normalized && !sources.includes(normalized)) {
        sources.push(normalized)
      }
    }
  }

  return sources
}

function toolError(parts: ToolCallPart[]): string | undefined {
  const failed = parts.find(part => part.isError)

  if (!failed) {
    return undefined
  }

  if (typeof failed.result === 'string') {
    return failed.result
  }

  return `工具 ${failed.toolName} 执行失败`
}

/** Derive the latest CLINVEXA task state from the authoritative Hermes message stream. */
export function CLINVEXAActivitiesFromMessages(messages: ChatMessage[]): CLINVEXAAgentActivity[] {
  const taskIndex = messages.findLastIndex(
    message => message.role === 'user' && (chatMessageText(message).includes(CLINVEXA_MARKER) || chatMessageText(message).startsWith('运行 CLINVEXA Skill：'))
  )

  if (taskIndex < 0) {
    return []
  }

  const isSkill = chatMessageText(messages[taskIndex]).startsWith('运行 CLINVEXA Skill：')
  const agentId = isSkill ? 'orchestrator' : parseAgentId(chatMessageText(messages[taskIndex]))

  if (!agentId) {
    return []
  }

  const nextUser = messages.findIndex((message, index) => index > taskIndex && message.role === 'user')
  const responses = messages.slice(taskIndex + 1, nextUser < 0 ? undefined : nextUser).filter(message => message.role === 'assistant' && !message.hidden)
  const calls = responses.flatMap(toolCalls)
  const result = responses.map(chatMessageText).filter(Boolean).at(-1)
  const error = responses.findLast(message => message.error)?.error ?? toolError(calls)
  const pending = responses.some(message => message.pending) || (!result && !error)
  const sources = sourceReferences(responses.map(chatMessageText).join('\n'))
  const tools = [...new Set(calls.map(part => part.toolName))]

  return [
    {
      agentId,
      ...(error ? { error } : {}),
      ...(result ? { result } : {}),
      sources,
      status: error ? 'failed' : pending ? 'running' : 'completed',
      ...(tools.length ? { tool: tools.join('、') } : {})
    }
  ]
}
