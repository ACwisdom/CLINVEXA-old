import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import { useCopilotLabels } from './labels'
import type { CopilotResult } from './types'

export function CopilotKnowledge() {
  const l = useCopilotLabels()
  const [sources, setSources] = useState<CopilotResult['sources']>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void window.hermesDesktop.CLINVEXACopilot?.knowledge().then(rows => {if (active) {setSources(rows)}}).catch(error => {if (active) {setNotice(String(error))}})

    return () => {active = false}
  }, [])

  return <details className="dc-material dc-library">
    <summary>{l.knowledge} · {sources.length}</summary>
    <p className="dc-muted">{l.libraryHelp}</p>
    {sources.map(source => <p key={source.id}>{source.title}<small className="dc-muted"> · {source.version} · {source.reviewer}</small></p>)}
    <form className="dc-question" onSubmit={event => {
      event.preventDefault()

      if (busy) {return}
      const form = event.currentTarget
      const data = new FormData(form)
      const value = (key: string) => String(data.get(key) || '')
      setBusy(true); setNotice('')
      void window.hermesDesktop.CLINVEXACopilot!.addKnowledge({title: value('title'), version: value('version'), reviewer: value('reviewer'), url: value('url'), text: value('text'), reviewed: true})
        .then(source => {setSources(rows => [...rows, source]); form.reset(); setNotice(l.sourceSaved)})
        .catch(error => setNotice(String(error))).finally(() => setBusy(false))
    }}>
      {([['title', l.sourceTitle, 200], ['version', l.sourceVersion, 100], ['reviewer', l.reviewer, 100], ['url', l.sourceUrl, 2000]] as const).map(([name, label, max]) => <label key={name}>{label}<input maxLength={max} name={name} required={name !== 'url'} type={name === 'url' ? 'url' : 'text'} /></label>)}
      <label>{l.sourceContent}<textarea maxLength={12000} minLength={20} name="text" required rows={5} /></label>
      <label className="dc-selection"><input required type="checkbox" />{l.reviewed}</label>
      <Button disabled={busy} type="submit">{l.addSource}</Button>
    </form>
    {notice && <p className="dc-notice" role="status">{notice}</p>}
  </details>
}
