import { describe, it, expect } from 'vitest'
import { translate, selectPlural } from './translate'

const cat = {
  'home.newConnection': 'New Connection',
  'workspace.filterActive': '{count} filters applied'
}

describe('translate', () => {
  it('キーを引く', () => {
    expect(translate(cat, 'home.newConnection')).toBe('New Connection')
  })
  it('{name} を補間する', () => {
    expect(translate(cat, 'workspace.filterActive', { count: 3 })).toBe('3 filters applied')
  })
  it('未知キーはキー文字列を返す（安全網）', () => {
    expect(translate(cat, 'missing.key')).toBe('missing.key')
  })
  it('未指定のトークンはそのまま残す', () => {
    expect(translate(cat, 'workspace.filterActive')).toBe('{count} filters applied')
  })
})

describe('selectPlural', () => {
  it('1 は one、それ以外は other（英語ルール）', () => {
    expect(selectPlural(1)).toBe('one')
    expect(selectPlural(0)).toBe('other')
    expect(selectPlural(2)).toBe('other')
  })
})
