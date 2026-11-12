import { useStore } from '@nanostores/react'
import { useRef, useState } from 'react'

import type { ChatBarProps } from '@/app/chat/composer/types'
import { notifyError } from '@/store/notifications'

import { resolveAssistantMention } from './assistant-mentions'
import { $summonedAssistants, bindAssistant, prepareAssistant, type SummonedAssistant } from './summon'

/** A failing capability load rejects the send; it must never become generic chat. */
export function useSummonedSubmit(
  sessionId: string | undefined,
  queueKey: string | undefined,
  main: boolean,
  catalog: readonly SummonedAssistant[] = []
) {
  const bindings = useStore($summonedAssistants)
  const assistant = main ? (bindings[queueKey || ''] ?? bindings[sessionId || '']) : undefined
  const [preparing, setPreparing] = useState(false)
  const lock = useRef(false)
  const current = useRef({ assistant, sessionId, queueKey, main })
  current.current = { assistant, sessionId, queueKey, main }

  const submit: (
    send: ChatBarProps['onSubmit'],
    ...args: Parameters<ChatBarProps['onSubmit']>
  ) => Promise<boolean> = async (send, text, options) => {
    // Native slash commands keep their existing dispatcher and do not run an agent.
    if (!main || text.trim().startsWith('/') || (!assistant && !/(^|\s)@/.test(text))) {
      return await send(text, options)
    }

    if (lock.current) {
      return false
    }

    lock.current = true
    setPreparing(true)
    const context = current.current

    try {
      const mention = resolveAssistantMention(text, catalog)
      const selected = mention.assistant ?? assistant

      if (!selected) {
        return await send(text, options)
      }

      const task = mention.task.trim() || '请使用当前对话及已附资料完成这个助手擅长的任务。'
      const invocation = await prepareAssistant(selected, task)
      const latest = current.current

      if (
        latest.assistant !== context.assistant ||
        latest.sessionId !== context.sessionId ||
        latest.queueKey !== context.queueKey ||
        latest.main !== context.main
      ) {
        return false
      }

      const accepted = await send(invocation, { ...options, sessionId, displayText: `@${selected.name}\n${task}` })

      if (accepted && mention.assistant) {
        bindAssistant(selected, [queueKey || '', sessionId || ''])
      }

      return accepted
    } catch (reason) {
      notifyError(reason, '助手加载失败，任务尚未发送')

      return false
    } finally {
      lock.current = false
      setPreparing(false)
    }
  }

  return { assistant, preparing, submit }
}
