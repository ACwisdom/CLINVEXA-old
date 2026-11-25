import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { afterEach, expect, it, vi } from 'vitest'

import { startWindowsForegroundWindowWatcher } from './clinvexa'

vi.mock('node:child_process', () => ({spawn: vi.fn()}))
afterEach(() => vi.clearAllMocks())

it('warms a paused watcher without exposing window data and resumes the same process', () => {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    killed: false, kill: vi.fn()
  })

  const write = vi.spyOn(child.stdin, 'write')
  vi.mocked(spawn).mockReturnValue(child as never)
  const onWindow = vi.fn(), onError = vi.fn()
  const watcher = startWindowsForegroundWindowWatcher(onWindow,onError,{paused:true})
  const row = JSON.stringify({windowId:'100',processName:'synthetic',title:'HIS'})+'\n'
  child.stdout.emit('data',row)
  expect(onWindow).not.toHaveBeenCalled()
  watcher.setPaused(false)
  child.stdout.emit('data',row)
  expect(onWindow).toHaveBeenCalledTimes(1)
  watcher.setPaused(true)
  child.stdout.emit('data',row)
  expect(onWindow).toHaveBeenCalledTimes(1)
  expect(spawn).toHaveBeenCalledTimes(1)
  expect(write.mock.calls.map(([command]) => command)).toEqual(['pause\n', 'resume\n', 'pause\n'])
  watcher.dispose()
  expect(watcher.isAlive()).toBe(false)
  expect(child.kill).toHaveBeenCalledOnce()
})
