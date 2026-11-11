import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ChevronDown, Clipboard, Copy, MessageSquareText as MessageSquare, X } from '@/lib/icons'

import { useCopilotLabels } from './labels'
import type { CopilotResult } from './types'

interface Props {
  result: CopilotResult
  fillReady: boolean
  focusedFill?: boolean
  onAsk: (question: string) => void
}

export function CopilotSuggestions({ result, fillReady, focusedFill = false, onAsk }: Props) {
  const l = useCopilotLabels()
  const [selected, setSelected] = useState<string[]>([])
  const [dismissed, setDismissed] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {setSelected([]); setDismissed([]); setNotice('')}, [result.id])

  const act = async (mode: 'copy' | 'fill', ids: string[]) => {
    if (busy) {return}
    setBusy(true)

    try {
      const bridge = window.hermesDesktop?.CLINVEXACopilot

      if (!bridge) {throw new Error(l.errorRetry)}
      const response = await bridge[mode](result.id, ids)
      setNotice(response.message)
    } catch (error) {setNotice(error instanceof Error ? error.message : l.errorRetry)}
    finally {setBusy(false)}
  }

  const visible = result.suggestions.filter(item => !dismissed.includes(item.id))

  return <div className="dc-suggestions">
    {visible.length === 0 && <p className="dc-muted">{l.noSuggestions}</p>}
    {visible.map(item => <article aria-label={item.title} className="dc-suggestion" key={item.id}>
      <div className="dc-suggestion-heading">
        <label className="dc-selection">
          <input aria-label={`${l.select} ${item.title}`} checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}
            type="checkbox" />
          <strong>{item.title}</strong>
        </label>
        <Button aria-label={`${l.dismiss} ${item.title}`} onClick={() => {
          setDismissed(current => [...current, item.id]); setSelected(current => current.filter(id => id !== item.id))
        }} size="icon-xs" variant="ghost"><X /></Button>
      </div>
      <p className="dc-suggestion-text">{item.text}</p>
      <p className="dc-muted dc-target">{item.targetLabel ? `${l.target} · ${item.targetLabel}` : l.noTarget}</p>
      <details className="dc-evidence">
        <summary><ChevronDown size={14} />{l.evidence}</summary>
        {item.reason && <p>{item.reason}</p>}
        {item.evidence.map((quote, i) => <blockquote key={`${i}-${quote}`}>{quote}</blockquote>)}
        {item.cautions.length > 0 && <ul>{item.cautions.map((text, i) => <li key={i}>{text}</li>)}</ul>}
        {item.sourceIds.map(id => {
          const source = result.sources.find(value => value.id === id)

          return source && <p className="dc-muted" key={id}>{l.source} · {source.title} · {source.version}</p>
        })}
      </details>
      <div className="dc-row dc-item-actions">
        <Button disabled={busy || !fillReady || (!focusedFill && !item.targetLabel)} onClick={() => void act('fill', [item.id])} size="sm" variant="outline"><Clipboard />{l.fill}</Button>
        <Button disabled={busy} onClick={() => void act('copy', [item.id])} size="sm" variant="ghost"><Copy />{l.copy}</Button>
        <Button aria-label={`${l.followup} ${item.title}`} onClick={() => onAsk(`${item.title}：${item.reason}`)} size="icon-sm" variant="ghost"><MessageSquare /></Button>
      </div>
    </article>)}
    {selected.length > 0 && <div className="dc-selection-bar">
      <span>{l.selected} {selected.length}</span>
      <Button disabled={busy} onClick={() => void act('copy', selected)} variant="outline">{l.copySelected}</Button>
      <Button disabled={busy || !fillReady} onClick={() => void act('fill', selected)}>{l.fillSelected}</Button>
    </div>}
    {notice && <p className="dc-notice" role="status">{notice}</p>}
    <p className="dc-muted dc-footnote">{l.fillNotice}</p>
  </div>
}
