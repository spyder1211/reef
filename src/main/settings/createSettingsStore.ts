import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { writeFileSecure } from '../util/writeFileSecure'
import { type AppSettings, type SettingsDeps, SettingsStore } from './SettingsStore'

const DEFAULT: AppSettings = { localePreference: 'auto' }

export function createSettingsStore(): SettingsStore {
  const filePath = join(app.getPath('userData'), 'settings.json')
  const deps: SettingsDeps = {
    load(): AppSettings {
      if (!existsSync(filePath)) return { ...DEFAULT }
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
        const pref = parsed?.localePreference
        return pref === 'en' || pref === 'ja' || pref === 'auto'
          ? { localePreference: pref }
          : { ...DEFAULT }
      } catch {
        return { ...DEFAULT }
      }
    },
    persist(settings: AppSettings): void {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSecure(filePath, JSON.stringify(settings, null, 2))
    }
  }
  return new SettingsStore(deps)
}
