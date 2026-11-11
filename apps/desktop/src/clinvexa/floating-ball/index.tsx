import { Activity, GripVertical } from '@/lib/icons'

import { useCopilotLabels } from '../copilot/labels'

interface CLINVEXAFloatingBallProps {
  expanded: boolean
  onOpen: () => void
  onContextMenu: () => void
  statusLabel: string
  active?: boolean
  hasSuggestions?: boolean
}

/** Render the compact, draggable CLINVEXA desktop entry. */
export function CLINVEXAFloatingBall({ expanded, onContextMenu, onOpen, statusLabel, active, hasSuggestions }: CLINVEXAFloatingBallProps) {
  const l = useCopilotLabels()

  if (expanded) {return null}

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center"
      onContextMenu={event => {
        event.preventDefault()
        onContextMenu()
      }}
    >
      <span className="sr-only" role="status">
        {statusLabel}
      </span>
      <span
        aria-label={l.drag}
        className="flex h-10 w-3 cursor-move items-center justify-center text-(--ui-text-tertiary) [-webkit-app-region:drag]"
      >
        <GripVertical aria-hidden="true" size={12} />
      </span>
      <button
        aria-expanded={expanded}
        aria-label={l.open}
        className="relative flex size-12 cursor-pointer items-center justify-center rounded-full bg-(--ui-accent) text-white shadow-nous outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-(--ui-accent) motion-reduce:transition-none"
        onClick={onOpen}
        type="button"
      >
        <Activity aria-hidden="true" size={24} strokeWidth={1.8} />
        {active && <span aria-hidden="true" className="absolute right-0 top-0 size-3 rounded-full border-2 border-(--ui-accent) bg-(--ui-bg-elevated)" />}
        {hasSuggestions && <span className="sr-only">{l.ready}</span>}
      </button>
    </div>
  )
}
