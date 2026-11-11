import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { useCopilotLabels } from './labels'
import type { CopilotResult, CopilotSuggestion } from './types'

/** Replace only explicitly chosen, exact heading blocks; keep all other prose. */
export function mergeSelectedUpdates(base: string, updates: CopilotSuggestion[], originals: Record<string, string>): string {
  let lines = base.split('\n')
  const heading = (line: string) => line.trim().replace(/[：:]$/, '')

  for (const item of updates) {
    const starts = lines.flatMap((line, i) => heading(line) === item.title ? [i] : [])
    const start = starts.length === 1 ? starts[0] : -1
    const oldLines = originals[item.title]?.split('\n')
    const newLines = item.text.split('\n')

    if (start >= 0 && newLines.every((line, i) => lines[start + 1 + i] === line)) {continue}

    if (start >= 0 && oldLines?.every((line, i) => lines[start + 1 + i] === line)) {
      // Replace only the known original text, never scan across doctor prose.
      lines.splice(start + 1, oldLines.length, ...newLines)
    } else {lines = [...lines, '', item.title, item.text]}
  }

  return lines.join('\n').trim()
}

export function CopilotCompare({result, previous, currentDraft, onApply}: {result: CopilotResult; previous?: CopilotResult; currentDraft?: string; onApply: (draft: string) => void}) {
  const l = useCopilotLabels()
  const [selected, setSelected] = useState<string[]>([])

  if (!previous) {return <p className="dc-muted">{l.noPrevious}</p>}
  const baseline = currentDraft ?? (previous.revision > 0 ? previous.draft : previous.suggestions.map(item => `${item.title}\n${item.text}`).join('\n\n'))
  const originals = Object.fromEntries(previous.suggestions.map(item => [item.title, item.text]))
  const updates = result.suggestions.filter(item => item.kind !== 'advice' && previous.suggestions.find(old => old.title === item.title)?.text !== item.text)

  return <div className="dc-material">
    <h3>{currentDraft !== undefined ? l.draft : l.previousDraft}</h3>
    <pre className="dc-version-text">{baseline}</pre>
    <h3>{l.proposed}</h3>
    {!updates.length && <p className="dc-muted">{l.noChanges}</p>}
    {updates.map(item => <div className="dc-suggestion" key={item.id}><label className="dc-selection"><input checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} type="checkbox" />{item.title}</label><p>{item.text}</p></div>)}
    <p className="dc-muted">{l.mergeHelp}</p>
    <Button disabled={!selected.length} onClick={() => onApply(mergeSelectedUpdates(baseline, updates.filter(item => selected.includes(item.id)), originals))}>{l.applyUpdates}</Button>
  </div>
}
