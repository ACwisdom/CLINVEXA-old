import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { ReviewDecision, ReviewDocument, ReviewJob, ReviewReport } from './api'
import { ContractPreaudit } from './preaudit'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('reopens a partial task, highlights the saved quote and keeps report decisions read only', async () => {
  const document: ReviewDocument = {
    id: 'doc', kind: 'contract', name: '合成合同.txt', text: '😀原文内容',
    sha256: 'a'.repeat(64), hash_basis: 'file', parser_version: '1', status: 'complete',
    diagnostics: [], reliability: 'source', segments: [{ anchor: 'line:1', start: 0, end: 5 }]
  }

  const task: ReviewJob = {
    id: 'job', contract_revision: 1, created_at: '2026-11-12T01:00:00Z', status: 'partial',
    coverage: { rules: 'complete', model: 'timeout' }, model: { name: 'test-model', requested: true },
    error: '院内模型响应超时', rules: { source: '试运行规则', version: 'p0-1' },
    documents: [document], elements: {}, decision_revision: 0, decisions: {},
    findings: [{
      id: 'finding', rule_id: 'CARD_AMOUNT', rule_version: 'p0-1', origin: 'rule', level: 'blocking',
      scope: 'contract', issue: '合成金额不一致', suggestion: '核实合同卡片',
      evidence: [{
        document_id: document.id, document_name: document.name, anchor: 'line:1', reliability: 'source',
        start: 1, end: 3, quote: '原文'
      }]
    }]
  }

  const savedDecision: ReviewDecision = {
    status: 'accepted', reviewer: '合成经办人', note: '核对完成', at: task.created_at
  }

  const resolved = { ...task, decision_revision: 1, decisions: { finding: [savedDecision] } }

  const report = {
    ...resolved, id: 'report', job_id: task.id, generated_at: task.created_at,
    contract: { title: '合成合同' }
  } satisfies Omit<ReviewReport, 'contract'> & { contract: { title: string } }

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/review-jobs')) {return Response.json([task])}

    if (url.endsWith('/review-jobs/job')) {return Response.json(task)}

    if (url.endsWith('/decision')) {
      expect(JSON.parse(String(init?.body))).toEqual({
        revision: 0, status: 'accepted', note: '核对完成'
      })

      return Response.json(resolved)
    }

    if (url.endsWith('/reports/report')) {return Response.json(report)}

    if (url.endsWith('/reports')) {return Response.json([report])}
    throw new Error('Unexpected URL: ' + url)
  })

  vi.stubGlobal('fetch', fetchMock)
  render(<ContractPreaudit busy={false} dirty={false} id="contract" modelReady={false} revision={2} run={(_label, action) => action()} />)
  fireEvent.change(await screen.findByLabelText('审查历史'), { target: { value: 'job' } })

  expect(await screen.findByText('此任务使用历史合同版本。')).toBeTruthy()
  expect(screen.getByText('模型辅助 · 超时')).toBeTruthy()
  const finding = screen.getByText(/合成金额不一致/).closest('li')!
  const citation = within(finding).getByText(/合成合同.txt · 第 1 行/).parentElement as HTMLDetailsElement
  citation.open = true
  fireEvent(citation, new Event('toggle'))
  expect(citation.querySelector('mark')?.textContent).toBe('原文')
  expect(citation.querySelector('blockquote')?.textContent).toBe('😀原文内容')

  fireEvent.change(within(finding).getByLabelText('复核决定'), { target: { value: 'accepted' } })
  fireEvent.change(within(finding).getByLabelText('复核备注'), { target: { value: '核对完成' } })
  fireEvent.click(within(finding).getByRole('button', { name: '保存此项复核' }))
  expect(await screen.findByText(/复核状态 · 确认问题 · 合成经办人/)).toBeTruthy()

  fireEvent.change(await screen.findByLabelText('已保存报告'), { target: { value: 'report' } })
  await waitFor(() => expect(screen.queryByLabelText('复核决定')).toBeNull())
  expect(screen.getByRole('button', { name: '导出报告 CSV' })).toBeTruthy()
})
