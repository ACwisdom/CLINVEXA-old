import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLINVEXARpa } from '.'

describe('CLINVEXA HIS RPA', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('prepares a draft and exposes formal submit only after doctor confirmation input', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const submitted = String(input).endsWith('/confirm')

      return new Response(
        JSON.stringify({
          failure_reason: null,
          state: submitted ? 'submitted' : 'awaiting_confirmation',
          task_id: 'task-ui'
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    })

    vi.stubGlobal('fetch', fetchMock)
    render(<CLINVEXARpa onClose={vi.fn()} />)

    expect(screen.getByText('HIS RPA 使用说明')).toBeTruthy()
    expect(screen.getByText(/患者与窗口核验/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('任务编号'), { target: { value: 'task-ui' } })
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'SYN-P001' } })
    fireEvent.change(screen.getByLabelText('HIS 窗口标识'), { target: { value: 'his-main' } })
    fireEvent.change(screen.getByLabelText('草稿内容'), { target: { value: '合成测试主诉' } })
    fireEvent.click(screen.getByRole('button', { name: '准备 HIS 草稿' }))

    expect(await screen.findByText('等待医生确认')).toBeTruthy()
    expect((screen.getByRole('button', { name: '确认并正式提交' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('确认医生编号'), { target: { value: 'doctor-001' } })
    fireEvent.click(screen.getByRole('button', { name: '确认并正式提交' }))

    await waitFor(() => expect(screen.getByText('已正式提交')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8001/clinvexa/rpa/tasks/prepare')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:8001/clinvexa/rpa/tasks/task-ui/confirm')
  })
})
