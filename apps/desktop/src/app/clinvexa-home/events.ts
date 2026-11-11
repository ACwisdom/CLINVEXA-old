export type CLINVEXAHomeAction =
  | 'all-medical-tools'
  | 'consultation'
  | 'platform-account'
  | 'first-use-demo'
  | 'knowledge-search'
  | 'quality-check'
  | 'record-structuring'
  | 'rpa'
  | 'scheduled-tasks'

const HOME_ACTION_EVENT = 'clinvexa:home-action'

export const requestCLINVEXAHomeAction = (action: CLINVEXAHomeAction): void => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent<CLINVEXAHomeAction>(HOME_ACTION_EVENT, { detail: action }))
}

export const onCLINVEXAHomeAction = (handler: (action: CLINVEXAHomeAction) => void): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const listener = (event: Event) => handler((event as CustomEvent<CLINVEXAHomeAction>).detail)

  window.addEventListener(HOME_ACTION_EVENT, listener)

  return () => window.removeEventListener(HOME_ACTION_EVENT, listener)
}
