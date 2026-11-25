import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Brain, RefreshCw } from '@/lib/icons'

import { $summonedAssistants, type SummonedAssistant } from '../summon'

interface Connection {
  connected: boolean
  url: string
  display_name: string
  account_id?: string
}
export const $platformConnection = atom<Connection | null>(null)
interface PlatformAgent {
  id: string
  name: string
  version: string
  description: string
  local_compatible: boolean
  unavailable_reason?: string
}

function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!window.hermesDesktop?.api) {
    return Promise.reject(new Error('CLINVEXA 后台尚未连接'))
  }

  return window.hermesDesktop.api<T>({ path: `/api/clinvexa/platform${path}`, method, body, timeoutMs: 30000 })
}

/** Account binding and available agents. Work happens in main chat. */
export function CLINVEXAPlatform({
  query = '',
  onSummon,
  accountOpen = false
}: {
  query?: string
  onSummon?: (assistant: SummonedAssistant) => Promise<void> | void
  accountOpen?: boolean
}) {
  const connection = useStore($platformConnection)
  const [agents, setAgents] = useState<PlatformAgent[]>([])
  const [url, setUrl] = useState('https://43.138.188.149:8443')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)

  async function sync() {
    const request = ++generation.current
    setLoading(true)
    setError('')

    try {
      const status = await api<Connection>('/status')

      if (request !== generation.current) {
        return
      }

      $platformConnection.set(status)

      if (status.url) {
        setUrl(status.url)
      }

      const rows = status.connected ? (await api<{ items: PlatformAgent[] }>('/agents')).items : []

      if (request === generation.current) {
        setAgents(rows)
      }
    } catch (reason) {
      if (request === generation.current) {
        setAgents([])
        setError(String(reason))
      }
    } finally {
      if (request === generation.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void sync()

    return () => {
      generation.current++
    }
  }, [])

  async function action(work: () => Promise<void>) {
    if (busy) {
      return
    }

    setBusy(true)
    setError('')

    try {
      await work()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const visible = agents.filter(row =>
    `${row.name} ${row.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )

  return (
    <section aria-label="账号智能体" className="dc-capability-section">
      <header className="dc-section-header">
        <div>
          <h3>
            账号智能体 <span className="dc-muted">{agents.length}</span>
          </h3>
          <p className="dc-muted">
            {connection?.connected ? `已绑定 · ${connection.display_name}` : '绑定平台账号，同步您安装的智能体'}
          </p>
        </div>
        <Button disabled={busy || loading} onClick={() => void sync()} size="sm" variant="ghost">
          <RefreshCw />
          同步
        </Button>
      </header>
      <details className="dc-account-details" open={accountOpen || undefined}>
        <summary>{connection?.connected ? '管理绑定账号' : '绑定平台账号'}</summary>
        {connection?.connected ? (
          <div className="dc-row dc-between">
            <span className="dc-muted">{connection.url}</span>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api('/connect', 'DELETE')
                  generation.current++
                  setAgents([])
                  $platformConnection.set(null)
                  $summonedAssistants.set(
                    Object.fromEntries(
                      Object.entries($summonedAssistants.get()).filter(([, item]) => item.source !== 'platform')
                    )
                  )
                })
              }
              size="sm"
              variant="outline"
            >
              退出平台账号
            </Button>
          </div>
        ) : (
          <form
            className="dc-platform-connect"
            onSubmit={event => {
              event.preventDefault()
              void action(async () => {
                const result = await api<Connection>('/connect', 'POST', { url, email, password })
                setPassword('')
                $platformConnection.set(result)
                await sync()
              })
            }}
          >
            <label htmlFor="dc-platform-url">平台地址</label>
            <Input id="dc-platform-url" onChange={e => setUrl(e.target.value)} required value={url} />
            <label htmlFor="dc-platform-email">平台账户</label>
            <Input
              autoComplete="username"
              id="dc-platform-email"
              onChange={e => setEmail(e.target.value)}
              required
              type="email"
              value={email}
            />
            <label htmlFor="dc-platform-password">密码</label>
            <Input
              autoComplete="current-password"
              id="dc-platform-password"
              onChange={e => setPassword(e.target.value)}
              required
              type="password"
              value={password}
            />
            <Button disabled={busy} type="submit">
              {busy ? '正在登录…' : '使用平台账号登录'}
            </Button>
          </form>
        )}
      </details>
      {error && (
        <p className="dc-notice" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="dc-muted" role="status">
          正在同步账号智能体…
        </p>
      )}
      {!loading && connection?.connected && !visible.length && (
        <p className="dc-muted">
          {query ? '没有匹配的账号智能体。' : '暂无可用智能体。在平台安装后，点击同步即可使用。'}
        </p>
      )}
      <div className="dc-capability-grid">
        {visible.map(agent => (
          <article className="dc-capability-card" key={agent.id}>
            <div className="dc-capability-heading">
              <Brain aria-hidden />
              <h4>{agent.name}</h4>
              <Button
                aria-label={`召唤 ${agent.name}`}
                disabled={busy || loading || !agent.local_compatible || !onSummon}
                onClick={() =>
                  void action(async () => {
                    await onSummon?.({
                      id: agent.id,
                      name: agent.name,
                      description: agent.description,
                      source: 'platform',
                      account: connection?.account_id
                    })
                  })
                }
                size="sm"
              >
                召唤
              </Button>
            </div>
            <p>{agent.description}</p>
            <span className="dc-muted">账号智能体 · {agent.version}</span>
            {!agent.local_compatible && (
              <p className="dc-muted">{agent.unavailable_reason || '此版本暂不支持本机调用'}</p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
