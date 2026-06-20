import { describe, it, expect, beforeEach, vi } from 'vitest'

// bootstrap は store 読み込み時に評価されるため、先に window.api をモックする。
const setLocaleMock = vi.fn(async (_p: string) => ({ effective: 'ja' as const }))
beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      i18n: {
        bootstrap: { systemLocale: 'en', preference: 'auto', effective: 'en' },
        setLocale: setLocaleMock
      }
    }
  })
})

describe('useAppStore i18n', () => {
  it('bootstrap から locale/preference を初期化', async () => {
    const { useAppStore } = await import('./useAppStore')
    expect(useAppStore.getState().locale).toBe('en')
    expect(useAppStore.getState().localePreference).toBe('auto')
  })
  it('setLocalePreference が main の effective を反映', async () => {
    const { useAppStore } = await import('./useAppStore')
    await useAppStore.getState().setLocalePreference('ja')
    expect(setLocaleMock).toHaveBeenCalledWith('ja')
    expect(useAppStore.getState().locale).toBe('ja')
    expect(useAppStore.getState().localePreference).toBe('ja')
  })
})
