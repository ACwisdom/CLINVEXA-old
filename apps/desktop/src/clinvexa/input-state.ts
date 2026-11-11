export const MISSING_TOOL_MESSAGE = '当前环境无该工具可调用'

export type CLINVEXAInputKind = 'current-screen' | 'file' | 'screenshot' | 'text' | 'voice'
export type CLINVEXAInputStatus = 'accepted' | 'unavailable'

export interface CLINVEXAInputCapabilities {
  currentScreen: boolean
  file: boolean
  screenshot: boolean
  voice: boolean
}

export interface CLINVEXAInputState {
  kind: CLINVEXAInputKind
  message: string
  status: CLINVEXAInputStatus
}

/** Resolve the explicit product contract for every CLINVEXA task input. */
export function resolveCLINVEXAInputStates(capabilities: CLINVEXAInputCapabilities): CLINVEXAInputState[] {
  const state = (kind: CLINVEXAInputKind, available: boolean): CLINVEXAInputState => ({
    kind,
    message: available ? '可用' : MISSING_TOOL_MESSAGE,
    status: available ? 'accepted' : 'unavailable'
  })

  return [
    state('text', true),
    state('voice', capabilities.voice),
    state('file', capabilities.file),
    state('screenshot', capabilities.screenshot),
    state('current-screen', capabilities.currentScreen)
  ]
}
