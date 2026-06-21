import { describe, expect, it } from 'vitest'
import { resolveLocale, systemLocaleFromElectron } from './resolveLocale'

describe('systemLocaleFromElectron', () => {
  it('ja で始まれば ja', () => {
    expect(systemLocaleFromElectron('ja')).toBe('ja')
    expect(systemLocaleFromElectron('ja-JP')).toBe('ja')
  })
  it('それ以外は en', () => {
    expect(systemLocaleFromElectron('en-US')).toBe('en')
    expect(systemLocaleFromElectron('fr')).toBe('en')
    expect(systemLocaleFromElectron('')).toBe('en')
  })
})

describe('resolveLocale', () => {
  it('auto はシステム言語に従う', () => {
    expect(resolveLocale('auto', 'ja')).toBe('ja')
    expect(resolveLocale('auto', 'en')).toBe('en')
  })
  it('明示指定はシステムより優先', () => {
    expect(resolveLocale('en', 'ja')).toBe('en')
    expect(resolveLocale('ja', 'en')).toBe('ja')
  })
})
