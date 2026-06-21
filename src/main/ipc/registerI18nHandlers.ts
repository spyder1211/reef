import { app, ipcMain } from 'electron'
import { resolveLocale, systemLocaleFromElectron } from '../../shared/i18n/resolveLocale'
import type { LocalePreference } from '../../shared/i18n/types'
import { setLocale } from '../i18n'
import type { SettingsStore } from '../settings/SettingsStore'

export function registerI18nHandlers(settings: SettingsStore, rebuildMenu: () => void): void {
  // 同期 bootstrap：renderer の初回レンダー前に確定させる（言語チラつき防止）。
  ipcMain.on('i18n:bootstrap', (event) => {
    const system = systemLocaleFromElectron(app.getLocale())
    const preference = settings.getLocalePreference()
    const effective = resolveLocale(preference, system)
    event.returnValue = { systemLocale: system, preference, effective }
  })

  ipcMain.handle('i18n:setLocale', (_e, preference: LocalePreference) => {
    const system = systemLocaleFromElectron(app.getLocale())
    const effective = resolveLocale(preference, system)
    settings.setLocalePreference(preference)
    setLocale(effective)
    rebuildMenu()
    return { effective }
  })
}
