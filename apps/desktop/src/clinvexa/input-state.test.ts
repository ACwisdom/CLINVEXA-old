import { describe, expect, it } from 'vitest'

import { MISSING_TOOL_MESSAGE, resolveCLINVEXAInputStates } from './input-state'

describe('CLINVEXA input contracts', () => {
  it('returns an explicit accepted or unavailable state for all five input types', () => {
    const states = resolveCLINVEXAInputStates({
      currentScreen: false,
      file: true,
      screenshot: false,
      voice: true
    })

    expect(states.map(state => state.kind)).toEqual(['text', 'voice', 'file', 'screenshot', 'current-screen'])
    expect(states.find(state => state.kind === 'text')?.status).toBe('accepted')
    expect(states.find(state => state.kind === 'voice')?.status).toBe('accepted')
    expect(states.find(state => state.kind === 'file')?.status).toBe('accepted')
    expect(states.find(state => state.kind === 'screenshot')?.message).toBe(MISSING_TOOL_MESSAGE)
    expect(states.find(state => state.kind === 'current-screen')?.message).toBe(MISSING_TOOL_MESSAGE)
  })
})
