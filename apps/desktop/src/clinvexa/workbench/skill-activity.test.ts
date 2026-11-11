import { expect, it } from 'vitest'

import { CLINVEXAActivitiesFromMessages } from './activity'

it('shows a deterministic skill result and does not attribute later chat to it', () => {
  const rows = CLINVEXAActivitiesFromMessages([
    { id: '1', role: 'user', parts: [{ type: 'text', text: '运行 CLINVEXA Skill：病历结构化' }] },
    { id: '2', role: 'assistant', parts: [{ type: 'text', text: '病历整理结果' }] },
    { id: '3', role: 'user', parts: [{ type: 'text', text: '另一项任务' }] },
    { id: '4', role: 'assistant', parts: [{ type: 'text', text: '不属于病历的结果' }] },
  ])

  expect(rows[0]).toMatchObject({ result: '病历整理结果', status: 'completed' })
})
