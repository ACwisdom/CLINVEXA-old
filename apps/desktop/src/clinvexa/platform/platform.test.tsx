import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $summonedAssistants, bindAssistant } from '../summon'

import { $platformConnection, CLINVEXAPlatform } from './index'

describe('account agent catalog', () => {
  afterEach(() => {
    cleanup()
    $platformConnection.set(null)
    $summonedAssistants.set({})
    vi.unstubAllGlobals()
  })
  it('lists all returned account agents, summons supported agents, and has no second task editor', async () => {
    const onSummon = vi.fn()

    const api = vi.fn(async (request: { path: string }) =>
      request.path.endsWith('/status')
        ? { connected: true, url: 'https://platform.test', display_name: '测试医生', account_id: 'origin|owner' }
        : {
            items: [
              { id: '1', name: '会议助手', description: '整理会议', version: '1', local_compatible: true },
              { id: '2', name: '知识助手', local_compatible: false, unavailable_reason: '知识库暂不支持' }
            ]
          }
    )

    vi.stubGlobal('hermesDesktop', { api })
    render(<CLINVEXAPlatform onSummon={onSummon} />)
    const button = await screen.findByRole('button', { name: '召唤 会议助手' })
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    expect(screen.getByRole('button', { name: '召唤 知识助手' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    await waitFor(() =>
      expect(onSummon).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', source: 'platform', account: 'origin|owner' })
      )
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(api.mock.calls.some(([call]) => call.path.endsWith('/runs'))).toBe(false)
    bindAssistant({ id: '1', name: '会议助手', source: 'platform', description: '' }, ['session'])
    fireEvent.click(screen.getByText('管理绑定账号'))
    fireEvent.click(screen.getByRole('button', { name: '退出平台账号' }))
    await waitFor(() => expect($summonedAssistants.get()).toEqual({}))
  })
  it('surfaces sync failure and keeps local work independent', async () => {
    vi.stubGlobal('hermesDesktop', {
      api: vi.fn(async () => {
        throw new Error('平台连接失败')
      })
    })
    render(<CLINVEXAPlatform onSummon={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('平台连接失败')
  })
})
