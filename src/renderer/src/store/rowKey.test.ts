import { describe, it, expect } from 'vitest'
import { rowKeyOf, pkValuesOf } from './rowKey'

describe('rowKeyOf', () => {
  it('主キー値が同じなら他列が違っても同じキー', () => {
    expect(rowKeyOf(['id'], { id: 1, x: 9 })).toBe(rowKeyOf(['id'], { id: 1, x: 7 }))
  })
  it('主キー値が違えば別キー', () => {
    expect(rowKeyOf(['id'], { id: 1 })).not.toBe(rowKeyOf(['id'], { id: 2 }))
  })
  it('複合主キー', () => {
    expect(rowKeyOf(['a', 'b'], { a: 1, b: 2 })).toBe(JSON.stringify([1, 2]))
  })
})

describe('pkValuesOf', () => {
  it('主キー列だけ抜き出す', () => {
    expect(pkValuesOf(['a', 'b'], { a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2 })
  })
})
