import { describe, expect, it } from 'vitest'

import { CLINVEXA_PAGES } from '@/clinvexa/navigation'

import { appViewForPath, CRON_ROUTE, routeSessionId } from '../../routes'

import { SIDEBAR_NAV } from './index'

describe('CLINVEXA sidebar navigation', () => {
  it('places medical pages directly after cron and reserves them as main workspace pages', () => {
    const next = SIDEBAR_NAV.slice(SIDEBAR_NAV.findIndex(item => item.id === 'cron') + 1)
    expect(next.slice(0, CLINVEXA_PAGES.length).map(item => item.route)).toEqual(CLINVEXA_PAGES.map(page => page.path))

    for (const page of CLINVEXA_PAGES) {
      expect(routeSessionId(page.path)).toBeNull()
      expect(appViewForPath(page.path)).toBe('extension')
      expect(SIDEBAR_NAV.filter(item => item.route === page.path)).toHaveLength(1)
    }
  })
  it('opens the existing cron page without defining a direct task action', () => {
    const cron = SIDEBAR_NAV.find(item => item.id === 'cron')

    expect(cron).toMatchObject({ id: 'cron', route: CRON_ROUTE })
    expect(cron?.action).toBeUndefined()
  })
})
