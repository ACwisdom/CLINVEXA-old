import { Send, X } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useI18n } from '@/i18n'

import { CLINVEXA_AGENT_IDS, CLINVEXAAgentInfo } from '../agent-info'
import type { CLINVEXARouteTarget } from '../agent-prompt'

interface CLINVEXASidebarProps {
  embedded?: boolean
  onClose: () => void
  onOpenConsultation: () => void
  onOpenRpa: () => void
  onOpenWorkbench: () => void
  onOpenSkillPlaza: () => void
  onStop?: () => Promise<void> | void
  onSubmit: (text: string, target?: CLINVEXARouteTarget) => Promise<void> | void
  submitError?: string | null
}

/** Render CLINVEXA's single compact task entry panel. */
export function CLINVEXASidebar({
  embedded = false,
  onClose,
  onOpenConsultation,
  onOpenRpa,
  onOpenWorkbench,
  onOpenSkillPlaza,
  onStop,
  onSubmit,
  submitError
}: CLINVEXASidebarProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const [routeTarget, setRouteTarget] = useState<CLINVEXARouteTarget>('auto')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const text = draft.trim()

    if (!text) {
      return
    }

    void onSubmit(text, routeTarget)
    setDraft('')
  }

  return (
    <aside
      aria-label="CLINVEXA 侧边栏"
      className={embedded ? 'dc-task-entry' : 'fixed inset-y-3 right-3 z-50 flex w-[min(390px,calc(100vw-24px))] flex-col rounded-2xl border border-(--ui-stroke-primary) bg-(--ui-bg-elevated) text-(--ui-text-primary) shadow-2xl'}
    >
      <header className="flex min-h-14 items-center justify-between border-b border-(--ui-stroke-primary) px-4">
        <div>
          <h2 className="text-sm font-semibold">CLINVEXA</h2>
          <p className="text-xs text-(--ui-text-secondary)">医生 AI 办公助手</p>
        </div>
        <button
          aria-label="关闭 CLINVEXA"
          className="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-(--ui-control-hover-background) focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={19} />
        </button>
      </header>

      {submitError && (
        <p
          className="mx-4 mb-3 rounded-lg border border-(--ui-danger) bg-(--ui-danger)/10 px-3 py-2 text-xs text-(--ui-danger)"
          role="alert"
        >
          {submitError}
        </p>
      )}

      <div className="flex-1 px-4">
        <p className="rounded-xl bg-(--ui-bg-secondary) p-3 text-sm leading-6 text-(--ui-text-secondary)">
          直接描述需要完成的任务。语音、文件和截图请使用主对话框输入区，执行状态与 CLINVEXA 主工作台保持一致。
        </p>
        <button
          className="mt-3 min-h-11 w-full rounded-xl bg-(--ui-accent) px-3 text-sm font-medium text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
          onClick={onOpenConsultation}
          type="button"
        >
          {t.CLINVEXA.consultation.start}
        </button>
        <button
          className="mt-2 min-h-11 w-full rounded-xl border border-(--ui-stroke-primary) px-3 text-sm hover:bg-(--ui-control-hover-background) focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
          onClick={onOpenWorkbench}
          type="button"
        >
          打开完整工作台
        </button>
        <button
          className="mt-2 min-h-11 w-full rounded-xl border border-(--ui-stroke-primary) px-3 text-sm hover:bg-(--ui-control-hover-background) focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
          onClick={onOpenSkillPlaza}
          type="button"
        >
          打开医疗智能体
        </button>
        <button
          className="mt-2 min-h-11 w-full rounded-xl border border-(--ui-stroke-primary) px-3 text-sm hover:bg-(--ui-control-hover-background) focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
          onClick={onOpenRpa}
          type="button"
        >
          打开 HIS RPA
        </button>
        {onStop && (
          <button
            className="mt-2 min-h-11 w-full rounded-xl border border-(--ui-stroke-primary) px-3 text-sm text-(--ui-danger) hover:bg-(--ui-control-hover-background) focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
            onClick={() => void onStop()}
            type="button"
          >
            停止当前任务
          </button>
        )}
      </div>

      <form className="border-t border-(--ui-stroke-primary) p-4" onSubmit={submit}>
        <label className="mb-2 block text-xs font-medium" htmlFor="clinvexa-agent-target">
          处理助手
        </label>
        <select
          className="mb-3 min-h-11 w-full rounded-xl border border-(--ui-stroke-primary) bg-(--ui-bg-input) px-3 text-sm"
          id="clinvexa-agent-target"
          onChange={event => setRouteTarget(event.target.value as CLINVEXARouteTarget)}
          value={routeTarget}
        >
          <option value="auto">自动选择 - 根据任务内容选择合适助手</option>
          {CLINVEXA_AGENT_IDS.map(agentId => <option key={agentId} value={agentId}>{CLINVEXAAgentInfo(agentId).name} - {CLINVEXAAgentInfo(agentId).description}</option>)}
        </select>
        <label className="mb-2 block text-xs font-medium" htmlFor="clinvexa-task-input">
          快捷任务
        </label>
        <div className="flex items-end gap-2">
          <textarea
            className="min-h-11 flex-1 resize-none rounded-xl border border-(--ui-stroke-primary) bg-(--ui-bg-input) px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
            id="clinvexa-task-input"
            onChange={event => setDraft(event.target.value)}
            placeholder="输入要交给所选助手完成的任务"
            rows={2}
            value={draft}
          />
          <button
            aria-label="发送任务"
            className="flex size-11 cursor-pointer items-center justify-center rounded-xl bg-(--ui-accent) text-white disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
            disabled={!draft.trim()}
            type="submit"
          >
            <Send aria-hidden="true" size={18} />
          </button>
        </div>
      </form>
    </aside>
  )
}
