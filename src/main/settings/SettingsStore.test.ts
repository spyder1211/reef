import { describe, it, expect } from 'vitest'
import { SettingsStore, type AppSettings, type SettingsDeps } from './SettingsStore'

function fakeDeps(initial: AppSettings): { deps: SettingsDeps; saved: AppSettings[] } {
  let current = initial
  const saved: AppSettings[] = []
  return {
    saved,
    deps: {
      load: () => current,
      persist: (s) => {
        current = s
        saved.push(s)
      }
    }
  }
}

describe('SettingsStore', () => {
  it('既定は auto', () => {
    const { deps } = fakeDeps({ localePreference: 'auto' })
    expect(new SettingsStore(deps).getLocalePreference()).toBe('auto')
  })
  it('set すると永続化される', () => {
    const { deps, saved } = fakeDeps({ localePreference: 'auto' })
    const store = new SettingsStore(deps)
    store.setLocalePreference('ja')
    expect(store.getLocalePreference()).toBe('ja')
    expect(saved).toEqual([{ localePreference: 'ja' }])
  })
})
