import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('retired artifact pane migration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('restores other panes while discarding a saved artifacts pane', async () => {
    localStorage.setItem('hermes.desktop.routeTiles.v1', JSON.stringify([
      { path: '/artifacts', dir: 'right' }, { path: '/skills', dir: 'left' }
    ]))
    const { $routeTiles, openRouteTile } = await import('./route-tiles')
    expect($routeTiles.get()).toEqual([{ path: '/skills', dir: 'left' }])
    openRouteTile('/artifacts?old=true')
    expect($routeTiles.get()).toHaveLength(1)
    openRouteTile('/messaging')
    expect($routeTiles.get().map(tile => tile.path)).toEqual(['/skills', '/messaging'])
  })
})
