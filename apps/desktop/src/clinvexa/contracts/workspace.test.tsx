import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ContractWorkspace } from './workspace'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('saves a new business contract before reviewing its saved revision', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.method) {
      return Response.json({ records: [], template: '起草提纲', model_ready: false, oa_ready: false })
    }

    const id = url.split('/')[5]
    const payload = JSON.parse(String(init.body))

    const draft = {
      title: '测试合同', counterparty: '', project_number: '', amount: null,
      body: '起草提纲', materials: {}, template_id: 'business', procurement_required: true,
      procurement_reference: '', starts_on: null, ends_on: null
    }

    if (init.method === 'PUT') {
      expect(payload.revision).toBe(0)
      expect(payload.draft).toEqual(draft)

      return Response.json({ id, revision: 1, draft, status: 'draft', review: null, events: [] })
    }

    expect(url).toMatch(/\/review$/)
    expect(payload).toEqual({ revision: 1, use_model: false })

    return Response.json({
      id, revision: 2, draft, status: 'reviewed', events: [],
      review: {
        ai_status: 'not_configured',
        findings: [{ level: 'blocking', source: '起草', issue: '缺少合同相对方', suggestion: '补充后再审' }]
      }
    })
  })

  vi.stubGlobal('fetch', fetchMock)
  render(<ContractWorkspace />)
  const create = screen.getByRole('button', { name: '新建业务合同' })

  await waitFor(() => expect(create.hasAttribute('disabled')).toBe(false))
  fireEvent.click(create)
  fireEvent.change(screen.getByLabelText('合同名称'), { target: { value: '测试合同' } })
  expect(screen.queryByRole('button', { name: '规则预审' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  fireEvent.click(await screen.findByRole('button', { name: '规则预审' }))
  expect(await screen.findByText(/缺少合同相对方/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: '提交 OA 测试审批' })).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
