import { useStore } from '@nanostores/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { navigateToWorkspacePage } from '@/app/routes'
import { SidebarPanelLabel } from '@/app/shell/sidebar-label'
import { Button } from '@/components/ui/button'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { notify } from '@/store/notifications'

import { recentConsultations } from './consultation/api'
import { $consultation, canLoadConsultation } from './consultation/live-session'
import { $copilot, connectCopilot } from './copilot/state'
import type { CopilotResult } from './copilot/types'
import { CLINVEXAPagePath } from './navigation'

interface HistoryRow {
  id: string
  title: string
  time: number
  taskKey?: string
}

export function copilotHistoryRows(rows: CopilotResult[]): HistoryRow[] {
  const tasks = new Map<string, CopilotResult>()
  for (const row of rows) {
    const previous = tasks.get(row.taskKey)
    if (
      !previous ||
      row.createdAt > previous.createdAt ||
      (row.createdAt === previous.createdAt && row.revision > previous.revision)
    )
      tasks.set(row.taskKey, row)
  }
  return [...tasks.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(row => ({
      id: row.id,
      taskKey: row.taskKey,
      title: row.patientName || row.title || '视觉分析记录',
      time: row.createdAt
    }))
}

function HistoryGroup({
  label,
  rows,
  query,
  activeId,
  loading,
  error,
  onRefresh,
  onOpen
}: {
  label: string
  rows: HistoryRow[]
  query: string
  activeId?: string
  loading: boolean
  error: boolean
  onRefresh: () => void
  onOpen: (row: HistoryRow) => void
}) {
  const [open, setOpen] = useState(true)
  const [count, setCount] = useState(3)
  const filtered = rows.filter(row =>
    `${row.title} ${new Date(row.time).toLocaleString('zh-CN')}`.toLowerCase().includes(query.toLowerCase())
  )
  const expanded = open || Boolean(query)
  return (
    <section aria-label={`${label}历史记录`} className="shrink-0 pb-2">
      <div className="flex items-center justify-between gap-1 pb-1.5 pt-3">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen(value => !value)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <SidebarPanelLabel>{label}</SidebarPanelLabel>
          <span className="text-xs text-(--ui-text-secondary)">{rows.length}</span>
          <DisclosureCaret open={expanded} />
        </button>
        <Button size="xs" variant="ghost" aria-label={`刷新${label.replace(/记录$/, '')}记录`} onClick={onRefresh}>
          刷新
        </Button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-1">
          {loading && !rows.length && <p className="px-2.5 py-2 text-xs text-(--ui-text-secondary)">正在读取记录…</p>}
          {error && (
            <p role="status" className="px-2.5 text-xs text-(--ui-text-secondary)">
              记录暂未同步，请刷新重试。
            </p>
          )}
          {!loading && !error && !filtered.length && (
            <p className="px-2.5 py-2 text-xs text-(--ui-text-secondary)">{query ? '没有匹配记录' : '暂无记录'}</p>
          )}
          {filtered.slice(0, query ? filtered.length : count).map(row => (
            <button
              key={row.id}
              type="button"
              aria-current={activeId === row.id ? 'page' : undefined}
              onClick={() => onOpen(row)}
              className="flex min-w-0 flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-(--ui-control-hover-background) aria-[current=page]:bg-(--ui-control-active-background)"
            >
              <span className="w-full truncate text-sm text-(--ui-text-primary)">{row.title}</span>
              <span className="text-xs tabular-nums text-(--ui-text-secondary)">
                {new Date(row.time).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </button>
          ))}
          {!query && filtered.length > count && (
            <Button size="sm" variant="ghost" onClick={() => setCount(value => value + 10)}>
              显示更多（{filtered.length - count}）
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/** The sidebar indexes existing records; it never starts capture, analysis or a new chat. */
export function CLINVEXAHistorySidebar({ query = '' }: { query?: string }) {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const live = useStore($copilot)
  const consultation = useStore($consultation)
  useEffect(connectCopilot, [])
  const visual = useQuery({
    queryKey: ['clinvexa-history', 'visual'],
    queryFn: async () => {
      const bridge = window.hermesDesktop?.CLINVEXACopilot
      if (!bridge) throw new Error('副驾驶未连接')
      return bridge.history()
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false
  })
  const voice = useQuery({
    queryKey: ['clinvexa-history', 'consultation'],
    queryFn: recentConsultations,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false
  })
  useEffect(() => {
    const result = live.result
    if (result)
      cache.setQueryData<CopilotResult[]>(['clinvexa-history', 'visual'], rows => [
        result,
        ...(rows ?? []).filter(row => row.id !== result.id)
      ])
  }, [cache, live.result])
  useEffect(() => {
    const record = consultation.record
    if (record)
      cache.setQueryData<Awaited<ReturnType<typeof recentConsultations>>>(
        ['clinvexa-history', 'consultation'],
        rows => [record, ...(rows ?? []).filter(row => row.id !== record.id)]
      )
  }, [cache, consultation.record])
  const visualRows = copilotHistoryRows([...(visual.data ?? []), ...(live.result ? [live.result] : [])])
  const voiceMap = new Map((voice.data ?? []).map(row => [row.id, row]))
  if (consultation.record) voiceMap.set(consultation.record.id, consultation.record)
  const voiceRows = [...voiceMap.values()]
    .map(row => ({
      id: row.id,
      title: row.patient_name || row.patient_id || '问诊记录',
      time: Date.parse(row.started_at)
    }))
    .sort((a, b) => b.time - a.time)
  const selected = new URLSearchParams(location.search).get('record') ?? undefined
  return (
    <>
      <HistoryGroup
        label="视觉副驾驶"
        query={query}
        rows={visualRows}
        loading={visual.isPending}
        error={visual.isError}
        activeId={location.pathname === CLINVEXAPagePath('copilot') ? (selected ?? live.result?.id) : undefined}
        onRefresh={() => void visual.refetch()}
        onOpen={row =>
          navigateToWorkspacePage(
            navigate,
            `${CLINVEXAPagePath('copilot')}?record=${encodeURIComponent(row.id)}&task=${encodeURIComponent(row.taskKey ?? '')}`
          )
        }
      />
      <HistoryGroup
        label="问诊记录"
        query={query}
        rows={voiceRows}
        loading={voice.isPending}
        error={voice.isError}
        activeId={location.pathname === CLINVEXAPagePath('consultation') ? consultation.record?.id : undefined}
        onRefresh={() => void voice.refetch()}
        onOpen={row => {
          if (consultation.record?.id !== row.id && !canLoadConsultation(consultation)) {
            notify({
              kind: 'error',
              title: '暂时不能切换问诊',
              message: '请先结束当前录音、等待处理完成并保存草稿，再打开其他记录。'
            })
            return
          }
          navigateToWorkspacePage(
            navigate,
            `${CLINVEXAPagePath('consultation')}?record=${encodeURIComponent(row.id)}`
          )
        }}
      />
    </>
  )
}
