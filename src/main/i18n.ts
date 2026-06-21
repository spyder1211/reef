import { createTranslator, type TranslationKey } from '../shared/i18n'
import type { Locale, TranslateParams } from '../shared/i18n/types'

let currentLocale: Locale = 'en'
let translator = createTranslator(currentLocale)

export function setLocale(l: Locale): void {
  currentLocale = l
  translator = createTranslator(l)
}

export function getLocale(): Locale {
  return currentLocale
}

export function t(key: TranslationKey, params?: TranslateParams): string {
  return translator.t(key, params)
}

export function tPlural(baseKey: string, count: number, params?: TranslateParams): string {
  return translator.tPlural(baseKey, count, params)
}
