import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import { BookOpen, RefreshCw, X } from '@/lib/icons'
import { CLINVEXAPlatform } from '../platform'
import type { SummonedAssistant } from '../summon'
import {
  type CLINVEXAPlazaSkill,
  installCLINVEXASkill,
  listCLINVEXASkills,
  setCLINVEXASkillEnabled,
  switchCLINVEXASkillVersion,
  uninstallCLINVEXASkill
} from './api'

interface Props {
  initialSource?: 'local' | 'platform'
  onClose: () => void
  onSummon: (assistant: SummonedAssistant) => Promise<void> | void
}
export function CLINVEXASkillPlaza({ onClose, onSummon, initialSource }: Props) {
  const [skills, setSkills] = useState<CLINVEXAPlazaSkill[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  async function refresh() {
    const request = ++generation.current
    setLoading(true)
    try {
      const rows = await listCLINVEXASkills()
      if (request === generation.current) {
        setSkills(rows)
      }
    } catch (reason) {
      if (request === generation.current) {
        setError(String(reason))
      }
    } finally {
      if (request === generation.current) {
        setLoading(false)
      }
    }
  }
  useEffect(() => {
    void refresh()
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
  const visible = skills.filter(skill =>
    `${skill.name} ${skill.title} ${skill.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
  return (
    <main aria-label="CLINVEXA 医疗智能体" className="dc-capability-catalog">
      <header className="dc-section-header">
        <div>
          <h2>医疗智能体</h2>
          <p className="dc-muted">选一位助手，回到主会话安排工作。</p>
        </div>
        <Button aria-label="关闭" onClick={onClose} size="icon-sm" variant="ghost">
          <X />
        </Button>
      </header>
      <SearchField
        aria-label="搜索智能体与本机技能"
        value={query}
        onChange={setQuery}
        placeholder="搜索智能体与本机技能"
      />
      <CLINVEXAPlatform query={query} onSummon={onSummon} accountOpen={initialSource === 'platform'} />
      <section aria-label="本机技能" className="dc-capability-section">
        <header className="dc-section-header">
          <div>
            <h3>
              本机技能 <span className="dc-muted">{skills.length}</span>
            </h3>
            <p className="dc-muted">在本机使用的医疗与办公能力</p>
          </div>
          <Button disabled={loading || busy} onClick={() => void refresh()} size="sm" variant="ghost">
            <RefreshCw />
            刷新
          </Button>
        </header>
        {error && (
          <p className="dc-notice" role="alert">
            {error}
          </p>
        )}
        {loading && (
          <p role="status" className="dc-muted">
            正在读取本机技能…
          </p>
        )}
        {skills.some(skill => skill.offline) && (
          <p className="dc-notice">CLINVEXA 本地服务正在恢复，恢复后可安装和召唤技能。</p>
        )}
        {!loading && !visible.length && <p className="dc-muted">没有匹配的本机技能。</p>}
        <div className="dc-capability-grid">
          {visible.map(skill => (
            <article className="dc-capability-card" key={skill.name}>
              <div className="dc-capability-heading">
                <BookOpen aria-hidden />
                <h4>{skill.title}</h4>
                <Button
                  aria-label={`召唤 ${skill.title}`}
                  disabled={busy || loading || skill.offline}
                  size="sm"
                  onClick={() =>
                    void action(async () => {
                      if (!skill.installed) {
                        await installCLINVEXASkill(skill.name, skill.default_version)
                      } else if (!skill.enabled) {
                        await setCLINVEXASkillEnabled(skill.name, true)
                      }
                      await onSummon({
                        id: skill.name,
                        name: skill.title,
                        description: skill.description,
                        source: 'local'
                      })
                    })
                  }
                >
                  召唤
                </Button>
              </div>
              <p>{skill.description}</p>
              <span className="dc-muted">
                本机技能 · {skill.version || skill.default_version}
                {!skill.installed ? ' · 召唤时安装' : !skill.enabled ? ' · 召唤时启用' : ''}
              </span>
              {skill.installed && (
                <details className="dc-capability-management">
                  <summary>管理技能</summary>
                  <div className="dc-row">
                    {skill.versions.length > 1 && (
                      <select
                        aria-label={`切换 ${skill.title} 版本`}
                        disabled={busy || skill.offline}
                        value={skill.version ?? skill.default_version}
                        onChange={event => {
                          const version = event.target.value
                          void action(async () => {
                            await switchCLINVEXASkillVersion(skill.name, version)
                            await refresh()
                          })
                        }}
                      >
                        {skill.versions.map(version => (
                          <option key={version}>{version}</option>
                        ))}
                      </select>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || skill.offline}
                      onClick={() =>
                        void action(async () => {
                          await setCLINVEXASkillEnabled(skill.name, !skill.enabled)
                          await refresh()
                        })
                      }
                    >
                      {skill.enabled ? '停用' : '启用'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || skill.offline}
                      onClick={() =>
                        void action(async () => {
                          await uninstallCLINVEXASkill(skill.name)
                          await refresh()
                        })
                      }
                    >
                      卸载
                    </Button>
                  </div>
                </details>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
