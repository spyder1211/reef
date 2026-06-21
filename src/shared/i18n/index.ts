import { en } from './en'
import { ja } from './ja'
import { selectPlural, translate } from './translate'
import type { Locale, TranslateParams } from './types'

export type TranslationKey = keyof typeof en

export const catalogs: Record<Locale, Record<TranslationKey, string>> = { en, ja }

export function createTranslator(locale: Locale): {
  t: (key: TranslationKey, params?: TranslateParams) => string
  tPlural: (baseKey: string, count: number, params?: TranslateParams) => string
} {
  const catalog = catalogs[locale]
  return {
    t: (key, params) => translate(catalog, key, params),
    tPlural: (baseKey, count, params) =>
      translate(catalog, `${baseKey}.${selectPlural(count)}`, params)
  }
}
