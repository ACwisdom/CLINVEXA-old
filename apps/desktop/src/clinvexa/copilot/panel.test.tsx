import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { CopilotPanel } from './panel'
import { $copilot } from './state'
import { CopilotSuggestions } from './suggestions'
import type { CopilotResult } from './types'

const result: CopilotResult = {
  id:'result-A',taskKey:'task-A',frameId:'frame-A',windowId:'100',processName:'his',title:'合成 HIS',
  capturedAt:1000,createdAt:2000,latencyMs:1000,patientId:'TEST-A',patientName:'测试患者',encounterId:'TEST-E',
  scene:'record',summary:'已识别 5 个病历栏',facts:['体温 36.5 ℃'],missing:[],sources:[],question:'',draft:'',revision:0,
  suggestions:['主诉','现病史','既往史','体格检查','辅助检查'].map((title, i) => ({id:`s${i}`,kind:'field',title,text:`合成资料 ${i}`,
    reason:'来自当前资料',evidence:['合成原文'],sourceIds:[],cautions:[],targetLabel:title}))
}

function setup() {
  const fill = vi.fn().mockResolvedValue({status:'failed',message:'无法定位，请使用复制',fields:[]})
  const copy = vi.fn().mockResolvedValue({status:'copied',message:'已复制',fields:[]})
  const state = {enabled:true,expanded:true,fillMode:false,status:'ready' as const,error:null,frameId:'frame-A',result,stale:false,startedAt:null,target:null}
  $copilot.set(state)
  Object.defineProperty(window,'hermesDesktop',{configurable:true,value:{CLINVEXACopilot:{fill,copy,
    getState:vi.fn().mockResolvedValue(state),onState:vi.fn().mockReturnValue(()=>{}),setExpanded:vi.fn(),setEnabled:vi.fn(),startFillMode:vi.fn().mockResolvedValue(undefined),stopFillMode:vi.fn().mockResolvedValue(undefined),analyze:vi.fn().mockResolvedValue(undefined)}}})

  return { fill, copy }
}

const wrapper = ({children}: {children: React.ReactNode}) => <I18nProvider configClient={null} initialLocale="zh">{children}</I18nProvider>
afterEach(cleanup)
afterEach(() => vi.restoreAllMocks())

describe('doctor copilot local actions', () => {
  it('keeps manual material but requires rebinding when the screen changes', async () => {
    setup(); render(<CopilotPanel />, {wrapper})
    await waitFor(() => expect(window.hermesDesktop.CLINVEXACopilot!.getState).toHaveBeenCalled())
    fireEvent.click(screen.getByText('补充资料（可选）'))
    fireEvent.change(screen.getByLabelText('补充资料（可选）'), {target:{value:'患者 A 的资料'}})
    fireEvent.change(screen.getByLabelText('基于识别结果继续处理'), {target:{value:'分析现有症状'}})
    act(() => $copilot.set({...$copilot.get(),frameId:'frame-B',stale:true}))
    fireEvent.click(screen.getByRole('button', {name:'发送并分析'}))
    expect(window.hermesDesktop.CLINVEXACopilot!.analyze).not.toHaveBeenCalled()
    expect((screen.getByLabelText('补充资料（可选）') as HTMLTextAreaElement).value).toBe('患者 A 的资料')
    fireEvent.click(screen.getByRole('button', {name:'已核对，用于当前画面'}))
    fireEvent.click(screen.getByRole('button', {name:'发送并分析'}))
    await waitFor(() => expect(window.hermesDesktop.CLINVEXACopilot!.analyze).toHaveBeenCalledWith('分析现有症状', '患者 A 的资料', 'frame-B', undefined))
  })
  it('starts with no selected advice and sends only the two chosen fields', async () => {
    const { fill } = setup()
    render(<CopilotSuggestions fillReady onAsk={vi.fn()} result={result} />, {wrapper})
    expect(screen.queryByText('填写所选')).toBeNull()
    fireEvent.click(screen.getByLabelText('选择 主诉')); fireEvent.click(screen.getByLabelText('选择 既往史'))
    fireEvent.click(screen.getByText('填写所选'))
    await waitFor(() => expect(fill).toHaveBeenCalledWith('result-A',['s0','s2']))
    expect((await screen.findByRole('status')).textContent).toContain('无法定位')
  })
  it('retains copy when a new patient invalidates direct fill', async () => {
    const {copy,fill}=setup()
    render(<CopilotSuggestions fillReady={false} onAsk={vi.fn()} result={result} />, {wrapper})
    expect((screen.getAllByText('快捷填写')[0] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByText('复制')[0])
    await waitFor(() => expect(copy).toHaveBeenCalledWith('result-A',['s0']))
    expect(fill).not.toHaveBeenCalled()
  })
  it('keeps a result for HIS filling from the floating panel', async () => {
    setup(); render(<CopilotPanel />, {wrapper})
    fireEvent.click(screen.getByRole('button', {name:'保留本结果可实现快捷填写'}))
    await waitFor(() => expect(window.hermesDesktop.CLINVEXACopilot!.startFillMode).toHaveBeenCalledWith('result-A'))
  })
  it('enables quick fill after the kept result follows a different HIS window', () => {
    setup()

    const fillState = {...$copilot.get(), fillMode:true, frameId:'target-frame', stale:false,
      target:{windowId:'100',title:'合成 HIS',processName:'chrome'}}

    $copilot.set(fillState)
    render(<CopilotPanel />, {wrapper})
    expect((screen.getAllByText('快捷填写')[0] as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('先点击系统中需要填写的输入框，再点击下方任意一条“快捷填写”；无需页面标题或建议标题一致。')).toBeTruthy()
  })
  it('shows evidence and accepts a follow-up inside the floating panel', async () => {
    setup()
    render(<CopilotPanel />, {wrapper})
    fireEvent.click(screen.getByLabelText('继续追问 主诉'))
    expect((screen.getByLabelText('基于识别结果继续处理') as HTMLTextAreaElement).value).toBe('主诉：来自当前资料')
    fireEvent.change(screen.getByLabelText('基于识别结果继续处理'),{target:{value:'请核对单位'}})
    fireEvent.click(screen.getByRole('button',{name:'发送并分析'}))
    await waitFor(() => expect(window.hermesDesktop.CLINVEXACopilot!.analyze).toHaveBeenCalledWith('请核对单位','','frame-A','result-A'))
  })
  it('supports an office document without a patient banner or follow-up tab', async () => {
    setup()

    const office = {...result, patientName:'', patientId:'', encounterId:'', scene:'writing' as const,
      summary:'识别到一份营业执照', facts:['公司名称：中软信息技术创新有限公司']}

    $copilot.set({...$copilot.get(), result:office})
    render(<CopilotPanel />, {wrapper})
    expect(screen.queryByText('当前患者身份未完整识别')).toBeNull()
    expect(screen.queryByRole('button',{name:'追问'})).toBeNull()
    fireEvent.change(screen.getByLabelText('基于识别结果继续处理'), {target:{value:'请整理这份文档的关键字段'}})
    fireEvent.click(screen.getByRole('button',{name:'发送并分析'}))
    await waitFor(() => expect(window.hermesDesktop.CLINVEXACopilot!.analyze).toHaveBeenCalledWith('请整理这份文档的关键字段','','frame-A','result-A'))
    expect((screen.getByLabelText('基于识别结果继续处理') as HTMLTextAreaElement).value).toBe('请整理这份文档的关键字段')
    act(() => $copilot.set({...$copilot.get(), result:{...office, id:'result-B', question:'请整理这份文档的关键字段'}}))
    await waitFor(() => expect((screen.getByLabelText('基于识别结果继续处理') as HTMLTextAreaElement).value).toBe(''))
  })
})
