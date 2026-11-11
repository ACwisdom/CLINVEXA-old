/** One navigation contract for the main sidebar, routes and floating assistant. */
export const CLINVEXA_PAGES = [
  { key: 'copilot', id: 'clinvexa-copilot', path: '/clinvexa-copilot', label: '视觉副驾驶', icon: 'eye' },
  { key: 'consultation', id: 'clinvexa-consultation', path: '/clinvexa-consultation', label: '问诊记录', icon: 'mic' },
  { key: 'skills', id: 'clinvexa-skills', path: '/clinvexa-skills', label: '医疗智能体', icon: 'hubot' },
  { key: 'activity', id: 'clinvexa-activity', path: '/clinvexa-activity', label: '任务进度', icon: 'tasklist' },
  { key: 'rpa', id: 'clinvexa-rpa', path: '/clinvexa-rpa', label: '桌面操作', icon: 'device-desktop' }
] as const

export type CLINVEXAPage = typeof CLINVEXA_PAGES[number]['key']
export type CLINVEXARouteId = typeof CLINVEXA_PAGES[number]['id']

export function CLINVEXAPageForPath(path: string): CLINVEXAPage | null {
  return CLINVEXA_PAGES.find(page => page.path === path)?.key ?? null
}

export function CLINVEXAPagePath(page: CLINVEXAPage | null): string {
  return CLINVEXA_PAGES.find(item => item.key === page)?.path ?? '/'
}
