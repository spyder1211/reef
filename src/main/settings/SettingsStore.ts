import type { LocalePreference } from '../../shared/i18n/types'

export interface AppSettings {
  localePreference: LocalePreference
}

export interface SettingsDeps {
  load(): AppSettings
  persist(settings: AppSettings): void
}

export class SettingsStore {
  private settings: AppSettings

  constructor(private deps: SettingsDeps) {
    this.settings = deps.load()
  }

  getLocalePreference(): LocalePreference {
    return this.settings.localePreference
  }

  setLocalePreference(pref: LocalePreference): void {
    this.settings = { ...this.settings, localePreference: pref }
    this.deps.persist(this.settings)
  }
}
