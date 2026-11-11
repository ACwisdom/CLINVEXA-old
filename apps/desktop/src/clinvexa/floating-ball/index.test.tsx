import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CLINVEXAFloatingBall } from '.'

describe('CLINVEXA floating ball', () => {
  it('opens the native exit menu on right click', () => {
    const onContextMenu = vi.fn()

    render(
      <CLINVEXAFloatingBall expanded={false} onContextMenu={onContextMenu} onOpen={vi.fn()} statusLabel="监听中" />
    )

    fireEvent.contextMenu(screen.getByRole('status').parentElement!)

    expect(onContextMenu).toHaveBeenCalledOnce()
  })

  it('provides a native drag handle without enlarging the visible status', () => {
    render(<CLINVEXAFloatingBall expanded={false} onContextMenu={vi.fn()} onOpen={vi.fn()} statusLabel="监听中" />)

    const dragHandle = screen.getByLabelText('Drag CLINVEXA')

    expect(dragHandle.className).toContain('[-webkit-app-region:drag]')
    expect(screen.getByRole('status').className).toContain('sr-only')
  })
})
