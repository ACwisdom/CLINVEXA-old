import { Codecs, persistentAtom } from '@/lib/persisted'

// Per-view sort direction for the Capabilities lists — persisted so each tab
// remembers most/least-used across navigations and restarts.
export const $skillsSortDesc = persistentAtom('hermes.desktop.capabilities.skillsSortDesc', true, Codecs.bool)
export const $toolsetsSortDesc = persistentAtom('hermes.desktop.capabilities.toolsetsSortDesc', true, Codecs.bool)

// CLINVEXA exposes exactly two user-facing capability groups. Persist the
// selected group so reopening the page returns doctors to the same list.
export const $skillsCategory = persistentAtom<'medical' | 'office'>(
  'clinvexa.desktop.capabilities.category',
  'medical',
  {
    decode: raw => (raw === 'office' ? 'office' : 'medical'),
    encode: value => value
  }
)
