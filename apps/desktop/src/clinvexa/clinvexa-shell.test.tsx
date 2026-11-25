import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $composerAttachments } from '@/store/composer'
import { setMessages } from '@/store/session'

import { CLINVEXADesktop } from './clinvexa-desktop'
import { CLINVEXA_PAGES } from './navigation'
import { CLINVEXAPageHost } from './page-host'
import { $CLINVEXAScreen } from './screen-monitor/state'

function renderDesktop(props: Omit<React.ComponentProps<typeof CLINVEXADesktop>, 'onSummon'> & { onSummon?: React.ComponentProps<typeof CLINVEXADesktop>['onSummon'] }) {
  let openSidebar = (_page?: string): void => {
    throw new Error('CLINVEXA sidebar bridge was not registered')
  }

  vi.stubGlobal('hermesDesktop', {
    CLINVEXAWindow: {
      onOpenSidebar: (callback: (page?: string) => void) => {
        openSidebar = callback

        return vi.fn()
      }
    }
  })
  const result = render(<MemoryRouter><Routes><Route element={null} path="/" />{CLINVEXA_PAGES.map(page => <Route element={<CLINVEXAPageHost />} key={page.id} path={page.path} />)}</Routes><CLINVEXADesktop onSummon={vi.fn()} {...props} /></MemoryRouter>)

  return {
    ...result,
    openSidebar: () => act(() => openSidebar('activity'))
  }
}

describe('CLINVEXA desktop shell', () => {
  afterEach(() => {
    cleanup()
    setMessages([])
    $composerAttachments.set([])
    $CLINVEXAScreen.set({ context: null, error: null, status: 'monitoring' })
    vi.unstubAllGlobals()
  })

  it('opens one accessible sidebar without rendering a second floating ball in the workbench', () => {
    const { openSidebar } = renderDesktop({ onSubmit: vi.fn() })

    expect(screen.queryByRole('button', { name: '打开 CLINVEXA' })).toBeNull()
    openSidebar()
    expect(screen.getByRole('complementary', { name: 'CLINVEXA 侧边栏' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '暂停屏幕监听' })).toBeNull()
    expect(screen.queryByText('voice')).toBeNull()
    expect(screen.queryByText('file')).toBeNull()
    expect(screen.queryByText('screenshot')).toBeNull()
    expect(screen.queryByText('current-screen')).toBeNull()
  })

  it('interrupts the current Hermes task from the CLINVEXA sidebar', () => {
    const onStop = vi.fn()
    const { openSidebar } = renderDesktop({ onStop, onSubmit: vi.fn() })

    openSidebar()
    fireEvent.click(screen.getByRole('button', { name: '停止当前任务' }))

    expect(onStop).toHaveBeenCalledOnce()
  })

  it('submits trimmed text once through the shared submit callback', () => {
    const onSubmit = vi.fn()
    const { openSidebar } = renderDesktop({ onSubmit })

    openSidebar()
    expect(screen.getByRole('option', { name: '自动选择 - 根据任务内容选择合适助手' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /任务协调助手 - 理解医生的目标/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /病历文书助手 - 提炼主诉/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /患者与医学资料助手 - 整理已提供的患者资料/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /屏幕与 HIS 填写助手 - 读取当前电脑画面/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('快捷任务'), { target: { value: '  生成门诊摘要  ' } })
    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('目标 Agent：medical_record'))
    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('生成门诊摘要'))
  })

  it('lets the doctor override the automatic Agent before submission', () => {
    const onSubmit = vi.fn()
    const { openSidebar } = renderDesktop({ onSubmit })

    openSidebar()
    fireEvent.change(screen.getByRole('combobox', { name: '处理助手' }), { target: { value: 'desktop_his' } })
    fireEvent.change(screen.getByLabelText('快捷任务'), { target: { value: '生成患者摘要' } })
    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.stringContaining('目标 Agent：desktop_his'))
  })

  it('opens a workbench driven by the live Hermes result and retries the same Agent', () => {
    const onSubmit = vi.fn()
    const { openSidebar } = renderDesktop({ onSubmit })
    openSidebar()
    fireEvent.change(screen.getByLabelText('快捷任务'), { target: { value: '生成病历草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))

    setMessages([
      {
        id: 'clinvexa-user',
        parts: [{ type: 'text', text: '[CLINVEXA V1 任务]\n目标 Agent：medical_record\n医生任务：生成病历草稿' }],
        role: 'user'
      },
      {
        error: 'medical record Agent interrupted',
        id: 'clinvexa-assistant',
        parts: [
          {
            args: { role: 'leaf' },
            isError: true,
            result: 'medical record Agent interrupted',
            toolCallId: 'delegate-1',
            toolName: 'delegate_task',
            type: 'tool-call'
          },
          { type: 'text', text: '病历草稿未完成\n来源：SYN-RECORD-001' }
        ],
        role: 'assistant'
      }
    ])

    fireEvent.click(screen.getByRole('button', { name: '打开完整工作台' }))

    expect(screen.getByRole('main', { name: 'CLINVEXA 工作台' })).toBeTruthy()
    expect(screen.getByText('任务分派')).toBeTruthy()
    expect(screen.getByText('SYN-RECORD-001')).toBeTruthy()
    expect(screen.getByText('medical record Agent interrupted')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试 病历文书助手' }))
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onSubmit).toHaveBeenLastCalledWith(expect.stringContaining('目标 Agent：medical_record'))
  })

  it('summons a capability without starting work from the catalog', async () => {
    const onSubmit = vi.fn()
    const onSummon = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      default_version: '1.0', dependencies: [], description: '整理科室文书', enabled: true,
      installed: true, name: 'department-weekly-report', scope: 'personal', title: '科室周报', version: '1.0', versions: ['1.0']
    }]), { status: 200 })))
    const { openSidebar } = renderDesktop({ onSubmit, onSummon })
    openSidebar()
    fireEvent.click(screen.getByRole('button', { name: '打开医疗智能体' }))
    fireEvent.click(await screen.findByRole('button', { name: '召唤 科室周报' }))
    await waitFor(() => expect(onSummon).toHaveBeenCalledWith(expect.objectContaining({ id: 'department-weekly-report', source: 'local' })))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByText('安排工作')).toBeNull()
  })

  it('opens the HIS RPA confirmation panel from the shared sidebar', () => {
    const { openSidebar } = renderDesktop({ onSubmit: vi.fn() })

    openSidebar()
    fireEvent.click(screen.getByRole('button', { name: '打开 HIS RPA' }))

    expect(screen.getByRole('main', { name: 'CLINVEXA HIS RPA' })).toBeTruthy()
    expect(screen.getByText('自动填写草稿，正式提交前必须医生确认')).toBeTruthy()
  })

  it('surfaces a CLINVEXA backend error when shared submission rejects', async () => {
    const { openSidebar } = renderDesktop({
      onSubmit: vi.fn(async () => Promise.reject(new Error('Hermes gateway is not connected')))
    })

    openSidebar()
    fireEvent.change(screen.getByLabelText('快捷任务'), { target: { value: '生成门诊摘要' } })
    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))

    expect((await screen.findByRole('alert')).textContent).toContain('CLINVEXA 后台未连接')
  })
})
