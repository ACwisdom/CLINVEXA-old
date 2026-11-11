import { describe, expect, it } from 'vitest'

import { createCLINVEXATaskStore } from './task-state'

describe('CLINVEXA shared task state', () => {
  it('deduplicates one task submitted from the ball, sidebar, and workbench', () => {
    const store = createCLINVEXATaskStore()

    const fromBall = store.submit({ correlationId: 'visit-001', input: '生成病历', surface: 'floating-ball' })
    const fromSidebar = store.submit({ correlationId: 'visit-001', input: '生成病历', surface: 'sidebar' })
    const fromWorkbench = store.submit({ correlationId: 'visit-001', input: '生成病历', surface: 'workbench' })

    expect(fromSidebar.id).toBe(fromBall.id)
    expect(fromWorkbench.id).toBe(fromBall.id)
    expect(store.snapshot()).toHaveLength(1)

    store.update(fromBall.id, 'completed')
    expect(store.snapshot()[0]?.status).toBe('completed')
  })
})
