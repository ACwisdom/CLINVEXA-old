import { useState } from 'react'

import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { Button } from '@/components/ui/button'

import { CLINVEXA_AGENT_IDS, CLINVEXAAgentInfo, type CLINVEXAAgentId } from '../agent-info'
import { useWorkspaceLabels } from '../workspace-labels'

export type { CLINVEXAAgentId } from '../agent-info'
export type CLINVEXAAgentStatus = 'completed' | 'failed' | 'running'

export interface CLINVEXAAgentActivity {
  agentId: CLINVEXAAgentId
  error?: string
  result?: string
  sources: string[]
  status: CLINVEXAAgentStatus
  tool?: string
}

interface CLINVEXAWorkbenchProps {
  activities: CLINVEXAAgentActivity[]
  onClose?: () => void
  onRetry: (agentId: CLINVEXAAgentId) => void
  onSwitchAgent: (from: CLINVEXAAgentId, to: CLINVEXAAgentId) => void
}

const STATUS_LABELS: Record<CLINVEXAAgentStatus, string> = {
  completed: '已完成',
  failed: '失败',
  running: '执行中'
}

const TOOL_LABELS: Record<string, string> = {
  computer_use: '屏幕操作',
  delegate_task: '任务分派',
  record_structuring: '病历结构化',
  'record-structuring': '病历结构化'
}

function toolLabel(tool?: string): string {
  return tool ? (TOOL_LABELS[tool] ?? tool) : '尚未调用工具'
}

/** Display CLINVEXA Agent progress, evidence, tools, and retry actions. */
export function CLINVEXAWorkbench({ activities, onClose, onRetry, onSwitchAgent }: CLINVEXAWorkbenchProps) {
  const l = useWorkspaceLabels()
  const [notice, setNotice] = useState('')

  return (
    <main aria-label="CLINVEXA 工作台" className="space-y-3 p-4 text-(--ui-text-primary)">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">CLINVEXA 工作台</h2>
          <p className="text-xs text-(--ui-text-secondary)">选择合适的助手处理任务；结果、依据和进度会显示在这里。</p>
        </div>
        {onClose && (
          <button
            aria-label="关闭 CLINVEXA 工作台"
            className="min-h-11 rounded-lg border border-(--ui-stroke-primary) px-3 text-xs"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        )}
      </header>
      <section aria-label="医疗智能体说明" className="grid gap-2 sm:grid-cols-2">
        {CLINVEXA_AGENT_IDS.map(agentId => {
          const agent = CLINVEXAAgentInfo(agentId)

          return <article className="rounded-xl border border-(--ui-stroke-primary) bg-(--ui-bg-secondary) p-3" key={agentId}>
            <h3 className="text-sm font-semibold">{agent.name}</h3>
            <p className="mt-1 text-xs text-(--ui-text-secondary)">{agent.description}</p>
            <p className="mt-2 text-xs text-(--ui-text-secondary)">{agent.useWhen}</p>
          </article>
        })}
      </section>
      {notice && <p className="dc-notice" role="status">{notice}</p>}
      {activities.length === 0 && <p className="text-sm text-(--ui-text-secondary)">尚无任务</p>}
      {activities.map(activity => (
        <article
          aria-label={CLINVEXAAgentInfo(activity.agentId).name}
          className="space-y-2 rounded-xl border border-(--ui-stroke-primary) p-3 text-sm"
          key={activity.agentId}
        >
          <div className="flex items-center justify-between gap-3">
            <strong>{CLINVEXAAgentInfo(activity.agentId).name}</strong>
            <span className="text-xs text-(--ui-text-secondary)">{STATUS_LABELS[activity.status]}</span>
          </div>
          <p>
            工具：<span className="text-(--ui-text-secondary)">{toolLabel(activity.tool)}</span>
          </p>
          <div>
            <span>来源：</span>
            {activity.sources.length > 0 ? (
              <ul className="list-inside list-disc text-(--ui-text-secondary)">
                {activity.sources.map(source => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            ) : (
              <span className="text-(--ui-text-secondary)">暂无来源</span>
            )}
          </div>
          {activity.result && <div className="rounded-lg bg-(--ui-bg-secondary) p-3"><CompactMarkdown text={activity.result} /><Button onClick={() => {void navigator.clipboard.writeText(activity.result!).then(() => setNotice(l.copied), () => setNotice(l.copyError))}} size="sm" variant="outline">{l.copy}</Button></div>}
          {activity.error && <p className="text-(--ui-danger)">{activity.error}</p>}
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`clinvexa-switch-${activity.agentId}`}>
              切换 {CLINVEXAAgentInfo(activity.agentId).name}
            </label>
            <select
              aria-label={`切换 ${CLINVEXAAgentInfo(activity.agentId).name}`}
              className="min-h-11 rounded-lg border border-(--ui-stroke-primary) bg-(--ui-bg-input) px-2 text-xs"
              id={`clinvexa-switch-${activity.agentId}`}
              onChange={event => onSwitchAgent(activity.agentId, event.target.value as CLINVEXAAgentId)}
              value={activity.agentId}
            >
              {CLINVEXA_AGENT_IDS.map(agentId => (
                <option key={agentId} value={agentId}>
                  {CLINVEXAAgentInfo(agentId).name}
                </option>
              ))}
            </select>
            {activity.status === 'failed' && (
              <button
                aria-label={`重试 ${CLINVEXAAgentInfo(activity.agentId).name}`}
                className="min-h-11 rounded-lg border border-(--ui-stroke-primary) px-3 text-xs"
                onClick={() => onRetry(activity.agentId)}
                type="button"
              >
                重试
              </button>
            )}
          </div>
        </article>
      ))}
    </main>
  )
}
