import type { Locale, LocalePreference } from './types'

export function systemLocaleFromElectron(electronLocale: string): Locale {
  return electronLocale.startsWith('ja') ? 'ja' : 'en'
}

export function resolveLocale(pref: LocalePreference, system: Locale): Locale {
  return pref === 'auto' ? system : pref
}
