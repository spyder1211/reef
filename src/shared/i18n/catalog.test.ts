import { describe, it, expect } from 'vitest'
import { en } from './en'
import { ja } from './ja'
import { createTranslator } from './index'

describe('カタログ整合性', () => {
  it('en と ja のキー集合が一致する', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort())
  })
  it('各キーの {token} 集合が en/ja で一致する', () => {
    const tokens = (s: string): string[] =>
      [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(tokens(ja[key])).toEqual(tokens(en[key]))
    }
  })
})

describe('createTranslator', () => {
  it('locale に応じた文字列を返す', () => {
    expect(createTranslator('en').t('home.newConnection')).toBe('New Connection')
    expect(createTranslator('ja').t('home.newConnection')).toBe('新規接続')
  })
  it('tPlural が count で one/other を選ぶ', () => {
    const t = createTranslator('en')
    expect(t.tPlural('workspace.filterActive', 1, { count: 1 })).toBe('1 filter applied')
    expect(t.tPlural('workspace.filterActive', 3, { count: 3 })).toBe('3 filters applied')
  })
})
