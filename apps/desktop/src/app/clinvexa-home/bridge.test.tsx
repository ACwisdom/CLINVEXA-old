import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { $skillsCategory } from '@/app/skills/store'

import { CLINVEXAHomeBridge } from './bridge'
import { requestCLINVEXAHomeAction } from './events'

vi.mock('@/app/chat/composer/focus', () => ({
  requestComposerFocus: vi.fn(),
  requestComposerInsert: vi.fn()
}))

function LocationProbe() {
  const location = useLocation()
  return <output>{location.pathname}{location.search}</output>
}

describe('CLINVEXAHomeBridge', () => {
  afterEach(() => {
    vi.clearAllMocks()
    $skillsCategory.set('medical')
  })

  it('opens only the existing cron route for the scheduled-task shortcut', async () => {
    render(<MemoryRouter initialEntries={['/']}><CLINVEXAHomeBridge /><LocationProbe /></MemoryRouter>)

    requestCLINVEXAHomeAction('scheduled-tasks')

    await waitFor(() => expect(document.querySelector('output')?.textContent).toBe('/cron'))
    expect(requestComposerInsert).not.toHaveBeenCalled()
  })

  it('prefills quality review without sending a task', async () => {
    render(<MemoryRouter><CLINVEXAHomeBridge /></MemoryRouter>)

    requestCLINVEXAHomeAction('quality-check')

    await waitFor(() => expect(requestComposerInsert).toHaveBeenCalledWith(
      '请检查已提供病历中的缺项、冲突、诊断确定性、剂量单位和时间问题，并列出需要医生确认的内容。',
      { target: 'main' }
    ))
    expect(requestComposerFocus).toHaveBeenCalledWith('main')
  })

  it('opens the existing medical Skills page and selects its existing medical category', async () => {
    render(<MemoryRouter initialEntries={['/']}><CLINVEXAHomeBridge /><LocationProbe /></MemoryRouter>)
    $skillsCategory.set('office')

    requestCLINVEXAHomeAction('all-medical-tools')

    await waitFor(() => expect(document.querySelector('output')?.textContent).toBe('/clinvexa-skills'))
    expect($skillsCategory.get()).toBe('medical')
  })
})
