import { useState } from 'react'

import { Button } from '@/components/ui/button'

/** Explicit window summon; a missing IPC bridge must not look like success. */
export function SummonCopilotBall() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function summon() {
    setBusy(true); setError('')

    try {
      const show = window.hermesDesktop?.CLINVEXAWindow?.showBall

      if (!show) {throw new Error('悬浮球连接不可用，请重启最新版 CLINVEXA 后重试。')}
      await show()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法唤起悬浮球，请重试。')
    } finally {setBusy(false)}
  }

  return <span>
    <Button disabled={busy} onClick={() => void summon()} variant="outline">{busy ? '正在唤起…' : '副驾驶悬浮球'}</Button>
    {error && <span className="dc-notice" role="alert">{error}</span>}
  </span>
}
