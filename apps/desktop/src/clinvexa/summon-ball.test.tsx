import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { SummonCopilotBall } from './summon-ball'
afterEach(() => {cleanup(); vi.unstubAllGlobals()})
it('invokes the window bridge on each explicit summon', async () => {
  const showBall = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('hermesDesktop', {CLINVEXAWindow: {showBall}})
  render(<SummonCopilotBall />)
  fireEvent.click(screen.getByRole('button', {name:'副驾驶悬浮球'}))
  await waitFor(() => expect(showBall).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(screen.getByRole('button', {name:'副驾驶悬浮球'}).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', {name:'副驾驶悬浮球'}))
  await waitFor(() => expect(showBall).toHaveBeenCalledTimes(2))
})
it('shows an actionable error when the native bridge is missing', async () => {
  vi.stubGlobal('hermesDesktop', {})
  render(<SummonCopilotBall />)
  fireEvent.click(screen.getByRole('button', {name:'副驾驶悬浮球'}))
  expect((await screen.findByRole('alert')).textContent).toContain('悬浮球连接不可用')
})
