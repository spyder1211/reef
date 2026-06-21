import { beforeEach, describe, expect, it } from 'vitest'
import { getLocale, setLocale, t } from './i18n'

describe('mainI18n', () => {
  beforeEach(() => setLocale('en'))
  it('既定は en', () => {
    expect(t('home.newConnection')).toBe('New Connection')
  })
  it('setLocale で切り替わる', () => {
    setLocale('ja')
    expect(getLocale()).toBe('ja')
    expect(t('home.newConnection')).toBe('新規接続')
  })
})
