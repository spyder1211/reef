import { describe, it, expect } from 'vitest'
import { fieldTypeName } from './mysqlTypes'

describe('fieldTypeName', () => {
  it('代表的な型コードを名前にする', () => {
    expect(fieldTypeName(8)).toBe('longlong')
    expect(fieldTypeName(253)).toBe('var_string')
    expect(fieldTypeName(7)).toBe('timestamp')
    expect(fieldTypeName(3)).toBe('long')
    expect(fieldTypeName(12)).toBe('datetime')
    expect(fieldTypeName(10)).toBe('date')
    expect(fieldTypeName(246)).toBe('newdecimal')
  })
  it('未知コードは type<code> でフォールバック', () => {
    expect(fieldTypeName(999)).toBe('type999')
  })
})
