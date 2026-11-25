import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'

const BALL_HEIGHT = 72
const BALL_MARGIN = 16
const BALL_WIDTH = 72

interface DisplayWorkArea {
  height: number
  width: number
  x: number
  y: number
}

/** Position the always-on-top CLINVEXA entry inside one display work area. */
export function CLINVEXABallBounds(workArea: DisplayWorkArea): DisplayWorkArea {
  return {
    height: BALL_HEIGHT,
    width: BALL_WIDTH,
    x: workArea.x + Math.max(0, workArea.width - BALL_WIDTH - BALL_MARGIN),
    y: workArea.y + Math.max(0, workArea.height - BALL_HEIGHT - BALL_MARGIN)
  }
}

export type CLINVEXAMonitorStatus = 'failed' | 'monitoring' | 'paused' | 'processing'

export interface ForegroundWindowIdentity {
  processName: string
  title: string
  windowId: string
}

export interface CLINVEXAScreenContext extends ForegroundWindowIdentity {
  capturedAt: number
  imageDataUrl?: string
  latencyMs: number
  observedAt: number
}

export interface CLINVEXAScreenMonitorSnapshot {
  context: CLINVEXAScreenContext | null
  error: string | null
  status: CLINVEXAMonitorStatus
}

interface CaptureResult {
  imageDataUrl?: string
  fingerprint?: Uint8Array
}

interface CLINVEXAScreenMonitorDependencies {
  capture: (identity: ForegroundWindowIdentity) => Promise<CaptureResult>
  now?: () => number
  onState?: (snapshot: CLINVEXAScreenMonitorSnapshot) => void
}

export interface CLINVEXAScreenMonitor {
  fail: (error: string) => void
  observe: (identity: ForegroundWindowIdentity) => Promise<CLINVEXAScreenContext | null>
  pause: () => void
  resume: () => void
  snapshot: () => CLINVEXAScreenMonitorSnapshot
}

/**
 * Create the event-driven CLINVEXA foreground-window monitor.
 *
 * Foreground observations include same-window ticks. Local frame comparison
 * emits content changes; model calls are scheduled independently.
 */
export function createCLINVEXAScreenMonitor(
  dependencies: CLINVEXAScreenMonitorDependencies
): CLINVEXAScreenMonitor {
  const now = dependencies.now ?? Date.now
  let lastIdentity = ''
  let lastImage = ''
  let lastFingerprint: Uint8Array | undefined
  let capturing = false
  let desiredIdentity = ''
  let generation = 0

  let state: CLINVEXAScreenMonitorSnapshot = {
    context: null,
    error: null,
    status: 'monitoring'
  }

  const publish = (next: CLINVEXAScreenMonitorSnapshot): void => {
    state = next
    dependencies.onState?.(state)
  }

  return {
    fail(error) {
      publish({ ...state, error, status: 'failed' })
    },
    async observe(identity) {
      if (state.status === 'paused') {
        return null
      }

      const identityKey = `${identity.windowId}\u0000${identity.processName}\u0000${identity.title}`

      if (desiredIdentity !== identityKey) {
        desiredIdentity = identityKey
        generation += 1
        publish({ context: null, error: null, status: 'processing' })
      }

      if (capturing) {return null}
      capturing = true

      const observedAt = now()
      const captureGeneration = generation

      try {
        const captured = await dependencies.capture(identity)

        if (captureGeneration !== generation) {
          return null
        }

        const unchanged = identityKey === lastIdentity && (
          captured.fingerprint && lastFingerprint
            ? !CLINVEXAFrameChanged(lastFingerprint, captured.fingerprint)
            : captured.imageDataUrl === lastImage
        )

        if (unchanged) {return state.context}

        const capturedAt = now()

        const context: CLINVEXAScreenContext = {
          ...identity,
          capturedAt,
          imageDataUrl: captured.imageDataUrl,
          latencyMs: Math.max(0, capturedAt - observedAt),
          observedAt
        }

        lastIdentity = identityKey
        lastImage = captured.imageDataUrl ?? ''
        lastFingerprint = captured.fingerprint
        publish({ context, error: null, status: 'monitoring' })

        return context
      } catch (error) {
        if (captureGeneration !== generation) {return null}
        const message = error instanceof Error ? error.message : String(error)
        publish({ ...state, error: message, status: 'failed' })

        return null
      } finally {
        capturing = false
      }
    },
    pause() {
      generation += 1
      publish({ ...state, status: 'paused' })
    },
    resume() {
      lastIdentity = ''
      desiredIdentity = ''
      publish({ context: null, error: null, status: 'monitoring' })
    },
    snapshot() {
      return state
    }
  }
}

/** Parse one complete UTF-8 event emitted by the Windows foreground watcher. */
export function parseForegroundWindowLine(line: string): ForegroundWindowIdentity | null {
  try {
    const value = JSON.parse(line) as Partial<ForegroundWindowIdentity>

    if (
      typeof value.windowId !== 'string' ||
      !value.windowId ||
      typeof value.processName !== 'string' ||
      !value.processName ||
      typeof value.title !== 'string'
    ) {
      return null
    }

    return {
      processName: value.processName,
      title: value.title,
      windowId: value.windowId
    }
  } catch {
    return null
  }
}

export interface CLINVEXAForegroundWatcher {
  dispose: () => void
  setPaused: (paused: boolean) => void
  isAlive: () => boolean
}

const WINDOWS_FOREGROUND_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class CLINVEXAForegroundWindow {
  public static volatile bool Enabled = false;
  private static readonly AutoResetEvent Changed = new AutoResetEvent(false);
  public static void WaitForNextTick() { Changed.WaitOne(Enabled ? 800 : 1000); }
  public static void ReadCommands() {
    var reader = new Thread(() => {
      string line;
      while ((line = Console.ReadLine()) != null) {
        Enabled = line == "resume";
        Changed.Set();
      }
      Environment.Exit(0);
    });
    reader.IsBackground = true;
    reader.Start();
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
[CLINVEXAForegroundWindow]::ReadCommands()
while ($true) {
  if (-not [CLINVEXAForegroundWindow]::Enabled) { [CLINVEXAForegroundWindow]::WaitForNextTick(); continue }
  $handle = [CLINVEXAForegroundWindow]::GetForegroundWindow()
  if ($handle -ne [IntPtr]::Zero) {
    $titleBuffer = [System.Text.StringBuilder]::new(1024)
    [void][CLINVEXAForegroundWindow]::GetWindowText($handle, $titleBuffer, $titleBuffer.Capacity)
    [uint32]$processId = 0
    [void][CLINVEXAForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
    $processName = ''
    try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { $processName = 'unknown' }
    $windowId = $handle.ToInt64().ToString()
    $key = $windowId + [char]0 + $processName + [char]0 + $titleBuffer.ToString()
    [pscustomobject]@{ windowId = $windowId; processName = $processName; title = $titleBuffer.ToString() } | ConvertTo-Json -Compress
  }
  [CLINVEXAForegroundWindow]::WaitForNextTick()
}
`

/** Observe every 800ms to detect changes within the same foreground window. */
export function startWindowsForegroundWindowWatcher(
  onWindow: (identity: ForegroundWindowIdentity) => void,
  onError: (message: string) => void,
  options: { paused?: boolean } = {}
): CLINVEXAForegroundWatcher {
  const child: ChildProcessWithoutNullStreams = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_FOREGROUND_SCRIPT],
    { windowsHide: true }
  )

  let pending = ''
  let paused = Boolean(options.paused)
  let alive = true
  child.stdin.on('error', error => { if (alive) {onError(error.message)} })
  child.stdin.write(paused ? 'pause\n' : 'resume\n')
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    pending += String(chunk)
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''

    for (const line of lines) {
      const identity = parseForegroundWindowLine(line.trim())

      if (identity && !paused) {
        onWindow(identity)
      }
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => onError(String(chunk).trim()))
  child.on('error', error => onError(error.message))
  child.on('exit', code => {
    alive = false

    if (code !== 0 && code !== null) {
      onError(`foreground watcher exited with code ${code}`)
    }
  })

  return {
    isAlive: () => alive && !child.killed,
    setPaused: value => {
      paused = value

      if (alive && !child.killed) {child.stdin.write(value ? 'pause\n' : 'resume\n')}
    },
    dispose: () => {
      alive = false

      if (!child.killed) {
        child.kill()
      }
    }
  }
}

/** Ignore low amplitude noise while retaining small text/patient changes. */
export function CLINVEXAFrameChanged(previous: Uint8Array, next: Uint8Array): boolean {
  if (previous.length !== next.length || previous.length === 0) {return true}
  let changed = 0

  for (let i = 0; i < next.length; i += 4) {
    if (Math.max(Math.abs(previous[i] - next[i]), Math.abs(previous[i + 1] - next[i + 1]), Math.abs(previous[i + 2] - next[i + 2])) > 18) {changed += 1}
  }

  return changed >= Math.max(2, next.length / 4 * 0.0005)
}

export function CLINVEXAPanelBounds(anchor: DisplayWorkArea, workArea: DisplayWorkArea, expanded: boolean): DisplayWorkArea {
  const width = expanded ? Math.min(460, workArea.width - 16) : BALL_WIDTH
  const height = expanded ? Math.min(740, workArea.height - 16) : BALL_HEIGHT

  return { width, height,
    x: Math.max(workArea.x + 8, Math.min(anchor.x + anchor.width - width, workArea.x + workArea.width - width - 8)),
    y: Math.max(workArea.y + 8, Math.min(anchor.y + anchor.height - height, workArea.y + workArea.height - height - 8)) }
}
