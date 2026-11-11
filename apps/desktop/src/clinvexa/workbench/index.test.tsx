import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CLINVEXAWorkbench } from '.'

describe('CLINVEXA medical workbench', () => {
  it('shows agent state, tool, sources, final result, and retry controls', () => {
    const onRetry = vi.fn()
    const onSwitchAgent = vi.fn()
    render(
      <CLINVEXAWorkbench
        activities={[
          {
            agentId: 'medical_record',
            result: '合成病历草稿',
            sources: ['SYN-RECORD-001'],
            status: 'completed',
            tool: 'record-structuring'
          },
          {
            agentId: 'knowledge_patient',
            error: 'knowledge source unavailable',
            sources: [],
            status: 'failed'
          }
        ]}
        onRetry={onRetry}
        onSwitchAgent={onSwitchAgent}
      />
    )

    expect(screen.getByRole('main', { name: 'CLINVEXA 工作台' })).toBeTruthy()
    expect(screen.getByText('病历结构化')).toBeTruthy()
    expect(screen.getByText('SYN-RECORD-001')).toBeTruthy()
    expect(screen.getByText('合成病历草稿')).toBeTruthy()
    expect(screen.getByText('knowledge source unavailable')).toBeTruthy()
    expect(screen.getByRole('region', { name: '医疗智能体说明' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '任务协调助手' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '病历文书助手' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '患者与医学资料助手' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '屏幕与 HIS 填写助手' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试 患者与医学资料助手' }))
    expect(onRetry).toHaveBeenCalledWith('knowledge_patient')

    fireEvent.change(screen.getByRole('combobox', { name: '切换 患者与医学资料助手' }), {
      target: { value: 'medical_record' }
    })
    expect(onSwitchAgent).toHaveBeenCalledWith('knowledge_patient', 'medical_record')
  })
})
