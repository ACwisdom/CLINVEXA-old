import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { $activeProfile } from '@/store/profile'

import { rememberAssistantAdditions } from './assistant-recency'
import { $platformConnection } from './platform'
import { listCLINVEXASkills } from './skill-plaza/api'
import type { SummonedAssistant } from './summon'

async function platformMentions(): Promise<SummonedAssistant[]> {
  if (!window.hermesDesktop?.api) {
    return []
  }

  const api = <T>(path: string) =>
    window.hermesDesktop.api<T>({
      path: `/api/clinvexa/platform${path}`,
      method: 'GET',
      timeoutMs: 8000
    })

  const status = await api<{ connected: boolean; account_id?: string }>('/status')

  if (!status.connected || !status.account_id) {
    return []
  }

  const result = await api<{
    items: { id: string; name: string; description: string; local_compatible: boolean; installed_at?: string }[]
  }>('/agents')

  return rememberAssistantAdditions(
    `platform:${status.account_id}`,
    result.items
      .filter(row => row.local_compatible)
      .map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        source: 'platform',
        addedAt: row.installed_at ? Date.parse(row.installed_at) : undefined,
        account: status.account_id
      }))
  )
}

/** Independent queries let local skills appear even while the platform is unavailable. */
export function useAssistantMentions(enabled: boolean) {
  const connection = useStore($platformConnection)
  const profile = useStore($activeProfile)

  const local = useQuery({
    queryKey: ['clinvexa-mention-skills', profile],
    enabled,
    staleTime: 10000,
    retry: false,
    queryFn: async (): Promise<SummonedAssistant[]> => {
      const rows = await listCLINVEXASkills()

      if (rows.some(row => row.offline)) {
        throw new Error('本机技能服务暂不可用')
      }

      const enabled = new Set(rows.filter(row => row.enabled).map(row => row.name))

      return rememberAssistantAdditions(
        `local:${profile}`,
        rows
          .filter(row => row.installed)
          .map(row => ({
            id: row.name,
            name: row.title,
            description: row.description,
            source: 'local',
            addedAt: row.added_at ? row.added_at * 1000 : undefined
          }))
      ).filter(row => enabled.has(row.id))
    }
  })

  const platform = useQuery({
    queryKey: ['clinvexa-mention-agents', profile, connection?.account_id ?? null, connection?.connected ?? false],
    enabled,
    staleTime: 10000,
    gcTime: 0,
    refetchOnMount: 'always',
    retry: false,
    queryFn: platformMentions
  })

  const assistants = useMemo(
    () =>
      enabled ? [...(platform.isError ? [] : (platform.data ?? [])), ...(local.isError ? [] : (local.data ?? []))] : [],
    [enabled, local.data, platform.data, local.isError, platform.isError]
  )

  const status = useMemo(
    () => ({
      local: local.isPending ? '正在读取技能…' : local.isError ? '技能服务暂不可用，请稍后重试' : undefined,
      platform: platform.isPending ? '正在同步智能体…' : platform.isError ? '智能体同步失败，请检查账号连接' : undefined
    }),
    [local.isPending, local.isError, platform.isPending, platform.isError]
  )

  const refresh = () => {
    if (!enabled) {
      return
    }

    if (Date.now() - local.dataUpdatedAt > 10000) {
      void local.refetch()
    }

    if (Date.now() - platform.dataUpdatedAt > 10000) {
      void platform.refetch()
    }
  }

  return { assistants, refresh, status }
}
