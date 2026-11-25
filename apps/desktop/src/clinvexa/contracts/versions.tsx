import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { compareVersions, type DiffBlock, loadVersions, statusLabels, type VersionEntry } from './api'

export function ContractVersions({ id }: {id: string}) {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [before, setBefore] = useState(0)
  const [after, setAfter] = useState(0)
  const [diff, setDiff] = useState<DiffBlock[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setBusy(true)
    setError('')
    try {
      const values = await loadVersions(id)

      setVersions(values)
      setBefore(values.at(-2)?.revision ?? values[0]?.revision ?? 0)
      setAfter(values.at(-1)?.revision ?? 0)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function compare() {
    setBusy(true)
    setError('')
    try {
      setDiff(await compareVersions(id, before, after))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="contract-section">
      <summary>审批版本与差异</summary>
      {error && <p role="alert">{error}</p>}
      {!versions.length ? <Button disabled={busy} onClick={() => void load()} size="sm" variant="outline">读取版本</Button> : (
        <>
          <div className="contract-fields">
            <label>对比起点<select onChange={event => {setBefore(Number(event.currentTarget.value)); setDiff(null)}} value={before}>
              {versions.map(item => <option key={item.revision} value={item.revision}>v{item.revision} · {statusLabels[item.status]}</option>)}
            </select></label>
            <label>对比终点<select onChange={event => {setAfter(Number(event.currentTarget.value)); setDiff(null)}} value={after}>
              {versions.map(item => <option key={item.revision} value={item.revision}>v{item.revision} · {statusLabels[item.status]}</option>)}
            </select></label>
          </div>
          <Button disabled={busy || before === after} onClick={() => void compare()} size="sm" variant="outline">比对版本</Button>
          {versions.length === 1 && <p>保存后续版本后可比对差异。</p>}
          {diff && !diff.length && <p>两个版本的合同内容一致。</p>}
          {diff?.map((block, i) => (
            <div className="contract-diff" key={i}>
              <div><small>旧版第 {block.before_line} 行</small><pre>{block.before.join('\n') || '（无）'}</pre></div>
              <div><small>新版第 {block.after_line} 行</small><pre>{block.after.join('\n') || '（无）'}</pre></div>
            </div>
          ))}
        </>
      )}
    </details>
  )
}
