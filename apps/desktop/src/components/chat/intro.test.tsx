import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { onCLINVEXAHomeAction } from '@/app/clinvexa-home/events'

import { Intro } from './intro'

describe('CLINVEXA home intro', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the specified Chinese homepage copy and all six clinical shortcuts', () => {
    render(<MemoryRouter><Intro /></MemoryRouter>)

    expect(screen.getByText('医生的智能工作助手')).toBeTruthy()
    expect(screen.getByText('从问诊记录到病历整理，再到 HIS 填写，让重复工作更快、更清楚、更可追溯')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '首次使用引导' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始体验' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '你可以从这里开始' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^我的平台智能体：/ })).toBeTruthy()
  })

  it('changes the visible cards locally when a category changes without emitting a task action', () => {
    const received = vi.fn()
    const unsubscribe = onCLINVEXAHomeAction(received)
    render(<MemoryRouter><Intro /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: '智能办公' }))

    expect(screen.getByRole('button', { name: /整理已有病历/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /填写 HIS 草稿/ })).toBeNull()
    expect(received).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('emits a navigation request for a shortcut but never sends a task itself', () => {
    const received = vi.fn()
    const unsubscribe = onCLINVEXAHomeAction(received)
    render(<MemoryRouter><Intro /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /定时任务：/ }))

    expect(received).toHaveBeenCalledWith('scheduled-tasks')
    unsubscribe()
  })
})
