import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

import { $copilot } from './state'
import type { CopilotResult } from './types'
import { CopilotWorkbench } from './workbench'

const make = (id: string, createdAt: number, texts: string[]): CopilotResult => ({id,taskKey:'a'.repeat(64),frameId:id,windowId:'100',processName:'test',title:'合成 HIS',capturedAt:createdAt,createdAt,latencyMs:1000,patientId:'A',patientName:'合成患者',encounterId:'E',scene:'record',summary:'合成病例',facts:[],missing:[],sources:[],question:'',draft:'',revision:0,suggestions:['主诉','辅助检查'].map((title,i)=>({id:`s${i}`,kind:'field',title,text:texts[i],reason:'',evidence:[],sourceIds:[],cautions:[],targetLabel:title}))})
const wrapper = ({children}: {children:React.ReactNode}) => <I18nProvider configClient={null} initialLocale="zh">{children}</I18nProvider>

describe('workbench review regressions', () => {
  afterEach(cleanup)
  it('opens a requested historical result even when a newer result is active', async () => {
    const old = make('old', 1000, ['历史主诉', '历史报告'])
    const latest = make('latest', 2000, ['最新主诉', '最新报告'])
    const state = { ...$copilot.get(), result: latest, status: 'ready' as const }
    $copilot.set(state)
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { CLINVEXACopilot: {
      getState: async () => state, onState: () => () => {}, history: async () => [latest], taskHistory: async () => [latest, old], versions: async () => []
    } } })
    render(<CopilotWorkbench onClose={() => {}} requestedRecordId="old" requestedTaskKey={old.taskKey} />, { wrapper })
    await waitFor(() => expect((screen.getByLabelText('结果与草稿历史') as HTMLSelectElement).value).toBe('old'))
    expect(screen.getByText('历史主诉')).toBeTruthy()
    expect(screen.queryByText('最新主诉')).toBeNull()
  })
  it('follows fresh results until a history entry is explicitly selected', async () => {
    const old=make('old',1000,['旧主诉','旧报告'])
    const latest=make('latest',2000,['新主诉','新报告'])
    const state={enabled:true,expanded:true,fillMode:false,status:'ready' as const,error:null,frameId:'old',result:old,stale:false,startedAt:null,target:null}
    $copilot.set(state)
    Object.defineProperty(window,'hermesDesktop',{configurable:true,value:{CLINVEXACopilot:{getState:vi.fn().mockResolvedValue(state),onState:()=>()=>{},history:async()=>[old],taskHistory:async()=>[old],versions:async()=>[]}}})
    render(<CopilotWorkbench onClose={()=>{}}/>,{wrapper})
    await waitFor(()=>expect((screen.getByLabelText('结果与草稿历史') as HTMLSelectElement).value).toBe('old'))
    act(()=>$copilot.set({...state,result:latest,frameId:'latest'}))
    await waitFor(()=>expect((screen.getByLabelText('结果与草稿历史') as HTMLSelectElement).value).toBe('latest'))
    fireEvent.change(screen.getByLabelText('结果与草稿历史'),{target:{value:'old'}})
    act(()=>$copilot.set({...state,result:make('newest',3000,['更新主诉','更新报告']),frameId:'newest'}))
    expect((screen.getByLabelText('结果与草稿历史') as HTMLSelectElement).value).toBe('old')
  })
  it('keeps a current failure separate from saved history and retries the current frame', async () => {
    const old=make('old',1000,['旧主诉','旧报告'])
    const state={enabled:true,expanded:true,fillMode:false,status:'error' as const,error:'本次画面结构校验未通过',frameId:'failing-frame',result:null,stale:true,startedAt:null,target:{title:'当前病历.txt',processName:'notepad',windowId:'101'}}
    const analyze=vi.fn().mockResolvedValue(undefined)
    $copilot.set(state)
    Object.defineProperty(window,'hermesDesktop',{configurable:true,value:{CLINVEXACopilot:{getState:vi.fn().mockResolvedValue(state),onState:()=>()=>{},history:async()=>[old],taskHistory:async()=>[old],versions:async()=>[],analyze}}})
    render(<CopilotWorkbench onClose={()=>{}}/>,{wrapper})
    await waitFor(()=>expect(screen.getByText('正在查看历史结果')).toBeTruthy())
    const alert=screen.getByRole('alert')
    expect(alert.textContent).toContain('当前病历.txt')
    expect(alert.textContent).toContain('下方是先前已保存的结果，不受本次错误影响。')
    expect(alert.textContent).not.toContain('合成病例')
    fireEvent.click(screen.getByRole('button',{name:'重新读取'}))
    expect(analyze).toHaveBeenCalledWith('', '', 'failing-frame')
  })
  it('merges twice from the current editor and restores an older saved result', async () => {
    const old=make('old',1000,['旧主诉','旧报告'])
    old.draft='主诉\n旧主诉\n\n辅助检查\n旧报告';old.revision=1
    const latest=make('latest',2000,['新主诉','新报告'])
    const state={enabled:false,expanded:true,fillMode:false,status:'off' as const,error:null,frameId:'latest',result:latest,stale:true,startedAt:null,target:null}
    $copilot.set(state)
    Object.defineProperty(window,'hermesDesktop',{configurable:true,value:{CLINVEXACopilot:{getState:vi.fn().mockResolvedValue(state),onState:()=>()=>{},history:async()=>[latest],taskHistory:async()=>[latest,old],versions:async()=>[],saveDraft:vi.fn(),setExpanded:vi.fn(),startFillMode:vi.fn(),stopFillMode:vi.fn()}}})
    render(<CopilotWorkbench onClose={()=>{}}/>,{wrapper})
    await waitFor(()=>expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(screen.queryByText(/正在更新/)).toBeNull()
    expect(screen.getByText('看屏已暂停，结果仅供查看和复制。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'医生草稿'}))
    const editor=screen.getByRole('textbox',{name:'医生草稿'})
    fireEvent.change(editor,{target:{value:'主诉\n医生修订主诉\n\n辅助检查\n旧报告\n\n医生备注\n需电话随访'}})
    fireEvent.click(screen.getByRole('button',{name:'更新对照'}))
    fireEvent.click(screen.getByLabelText('辅助检查'))
    fireEvent.click(screen.getByRole('button',{name:'采用所选，进入编辑'}))
    expect((screen.getByRole('textbox',{name:'医生草稿'}) as HTMLTextAreaElement).value).toContain('医生修订主诉')
    fireEvent.click(screen.getByRole('button',{name:'更新对照'}))
    fireEvent.click(screen.getByLabelText('主诉'))
    fireEvent.click(screen.getByRole('button',{name:'采用所选，进入编辑'}))
    const value=(screen.getByRole('textbox',{name:'医生草稿'}) as HTMLTextAreaElement).value
    expect(value).toContain('新报告');expect(value).toContain('医生修订主诉');expect(value).toContain('医生备注\n需电话随访');expect(value).toContain('新主诉')
    fireEvent.change(screen.getByLabelText('结果与草稿历史'),{target:{value:'old'}})
    expect((screen.getByRole('textbox',{name:'医生草稿'}) as HTMLTextAreaElement).value).toBe(old.draft)
    fireEvent.change(screen.getByLabelText('结果与草稿历史'),{target:{value:'latest'}})
    expect((screen.getByRole('textbox',{name:'医生草稿'}) as HTMLTextAreaElement).value).toBe(value)
  })
})
