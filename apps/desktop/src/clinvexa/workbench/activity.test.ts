import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { CLINVEXAActivitiesFromMessages } from './activity'

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return { parts: [], ...overrides }
}

describe('CLINVEXA live Agent activity', () => {
  it('derives running Agent and native Hermes tool state from the current turn', () => {
    const activities = CLINVEXAActivitiesFromMessages([
      message({
        id: 'user-1',
        parts: [{ type: 'text', text: '[CLINVEXA V1 任务]\n目标 Agent：medical_record\n医生任务：生成病历' }],
        role: 'user'
      }),
      message({
        id: 'assistant-1',
        parts: [
          {
            args: { role: 'leaf', task: '结构化病历' },
            toolCallId: 'delegate-1',
            toolName: 'delegate_task',
            type: 'tool-call'
          }
        ],
        pending: true,
        role: 'assistant'
      })
    ])

    expect(activities).toEqual([
      expect.objectContaining({ agentId: 'medical_record', status: 'running', tool: 'delegate_task' })
    ])
  })

  it('shows final result and explicit evidence sources from Hermes messages', () => {
    const activities = CLINVEXAActivitiesFromMessages([
      message({
        id: 'user-1',
        parts: [{ type: 'text', text: '[CLINVEXA V1 任务]\n目标 Agent：knowledge_patient' }],
        role: 'user'
      }),
      message({
        id: 'assistant-1',
        parts: [
          { args: {}, result: '检索完成', toolCallId: 'search-1', toolName: 'web_search', type: 'tool-call' },
          { type: 'text', text: '随访草稿已生成\n来源：院内指南-SYN-001；病历-SYN-002' }
        ],
        role: 'assistant'
      })
    ])

    expect(activities).toEqual([
      {
        agentId: 'knowledge_patient',
        result: '随访草稿已生成\n来源：院内指南-SYN-001；病历-SYN-002',
        sources: ['院内指南-SYN-001', '病历-SYN-002'],
        status: 'completed',
        tool: 'web_search'
      }
    ])
  })

  it('keeps a failed child visible and retryable instead of crashing the workbench', () => {
    const activities = CLINVEXAActivitiesFromMessages([
      message({
        id: 'user-1',
        parts: [{ type: 'text', text: '[CLINVEXA V1 任务]\n目标 Agent：desktop_his' }],
        role: 'user'
      }),
      message({ id: 'assistant-1', error: 'desktop Agent interrupted', role: 'assistant' })
    ])

    expect(activities).toEqual([
      {
        agentId: 'desktop_his',
        error: 'desktop Agent interrupted',
        sources: [],
        status: 'failed'
      }
    ])
  })

  it('ignores ordinary Hermes conversations', () => {
    const activities = CLINVEXAActivitiesFromMessages([
      message({ id: 'user-1', parts: [{ type: 'text', text: '普通对话' }], role: 'user' })
    ])

    expect(activities).toEqual([])
  })
})
