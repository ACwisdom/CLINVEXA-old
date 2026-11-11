import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLINVEXASkillPlaza } from '.'

const catalog = [
  {
    default_version: '1.0.0',
    dependencies: [],
    description: '病历结构化，保留来源证据并要求医生复核。',
    enabled: false,
    installed: false,
    name: 'record-structuring',
    scope: 'platform',
    title: '病历结构化',
    version: null,
    versions: ['1.0.0', '1.1.0']
  },
  {
    default_version: '1.0.0',
    dependencies: [],
    description: '患者随访计划草稿。',
    enabled: true,
    installed: true,
    name: 'followup-plan',
    scope: 'personal',
    title: '随访计划',
    version: '1.0.0',
    versions: ['1.0.0']
  }
]

describe('CLINVEXA Skill plaza', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('browses, searches, installs, and runs enabled local Skills', async () => {
    const onSummon = vi.fn()

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ enabled: true, name: 'record-structuring', version: '1.0.0' }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      }

      return new Response(JSON.stringify(catalog), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    })

    vi.stubGlobal('fetch', fetchMock)
    render(<CLINVEXASkillPlaza onClose={vi.fn()} onSummon={onSummon} />)

    expect(await screen.findByText('病历结构化')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜索智能体与本机技能'), { target: { value: '病历' } })
    expect(screen.queryByText('随访计划')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '召唤 病历结构化' }))
    await waitFor(() => expect(onSummon).toHaveBeenCalled())

    expect(screen.queryByText('安排工作')).toBeNull()
    expect(screen.queryByText('任务过程与结果')).toBeNull()
    expect(onSummon).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'record-structuring', name: '病历结构化', source: 'local' })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8001/clinvexa/skills/record-structuring/install',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('shows the bundled medical catalog while the local service restarts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('service unavailable')))
    )
    render(<CLINVEXASkillPlaza onClose={vi.fn()} onSummon={vi.fn()} />)

    expect(await screen.findByText('病历结构化')).toBeTruthy()
    expect(screen.getByText('科室周报')).toBeTruthy()
    expect(screen.getByText(/CLINVEXA 本地服务正在恢复/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '召唤 病历结构化' }).hasAttribute('disabled')).toBe(true)
  })
})
