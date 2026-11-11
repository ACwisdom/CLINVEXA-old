import { atom } from 'nanostores'

/** The persistent service/controller renders into the active main workspace page.
 * Navigating away unmounts the page, not the ongoing consultation owner. */
export const $CLINVEXAPageHost = atom<HTMLDivElement | null>(null)

const setHost = (node: HTMLDivElement | null) => { $CLINVEXAPageHost.set(node) }

export function CLINVEXAPageHost() {
  return <div className="dc-main-page-host" ref={setHost} />
}
