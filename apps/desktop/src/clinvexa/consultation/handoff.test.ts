import { describe, expect, it, vi } from 'vitest'

import { handoffConsultationToPersistedNewSession } from './handoff'

describe('consultation Agent handoff', () => {
  it('creates a stored conversation before submitting to that exact runtime', async () => {
    const order: string[] = []
    const prepareFreshDraft = vi.fn(() => order.push('prepare-without-navigation'))

    const createSession = vi.fn(async (preview: string) => {
      order.push(`create:${preview}`)

      return 'runtime-medical-record'
    })

    const getStoredSessionId = vi.fn(() => 'stored-medical-record')

    const submit = vi.fn(async (prompt: string) => {
      order.push(`submit:${prompt}`)

      return true
    })

    const result = await handoffConsultationToPersistedNewSession('整理本次问诊', {
      createSession,
      getStoredSessionId,
      prepareFreshDraft,
      submit
    })

    expect(result).toBe(true)
    expect(order).toEqual([
      'prepare-without-navigation',
      'create:整理本次问诊',
      'submit:整理本次问诊'
    ])
    expect(submit).toHaveBeenCalledWith('整理本次问诊', {
      sessionId: 'runtime-medical-record',
      storedSessionId: 'stored-medical-record'
    })
  })

  it('does not submit when the backend fails to create a stored conversation', async () => {
    const submit = vi.fn()

    const result = await handoffConsultationToPersistedNewSession('整理本次问诊', {
      createSession: async () => null,
      getStoredSessionId: () => null,
      prepareFreshDraft: vi.fn(),
      submit
    })

    expect(result).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })
})
