import { describe, expect, it } from 'vitest'
import { wrapIndex } from './overlay'

describe('wrapIndex', () => {
  it('前進', () => {
    expect(wrapIndex(0, 3, 1)).toBe(1)
    expect(wrapIndex(1, 3, 1)).toBe(2)
  })
  it('後退', () => {
    expect(wrapIndex(2, 3, -1)).toBe(1)
  })
  it('末尾→先頭にラップ', () => {
    expect(wrapIndex(2, 3, 1)).toBe(0)
  })
  it('先頭→末尾にラップ', () => {
    expect(wrapIndex(0, 3, -1)).toBe(2)
  })
  it('count<=0 は 0', () => {
    expect(wrapIndex(0, 0, 1)).toBe(0)
    expect(wrapIndex(2, -1, 1)).toBe(0)
  })
})
