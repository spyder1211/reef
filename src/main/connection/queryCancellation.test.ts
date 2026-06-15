import { describe, it, expect } from 'vitest'
import { QueryCancelledError, isQueryInterrupted } from './queryCancellation'

describe('queryCancellation', () => {
  it('code が ER_QUERY_INTERRUPTED なら中断とみなす', () => {
    expect(isQueryInterrupted({ code: 'ER_QUERY_INTERRUPTED' })).toBe(true)
  })
  it('errno が 1317 なら中断とみなす', () => {
    expect(isQueryInterrupted({ errno: 1317 })).toBe(true)
  })
  it('別のエラーは中断とみなさない', () => {
    expect(isQueryInterrupted({ code: 'ER_PARSE_ERROR', errno: 1064 })).toBe(false)
    expect(isQueryInterrupted(null)).toBe(false)
    expect(isQueryInterrupted(undefined)).toBe(false)
    expect(isQueryInterrupted(new Error('x'))).toBe(false)
  })
  it('QueryCancelledError は Error の派生で name が付く', () => {
    const e = new QueryCancelledError()
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('QueryCancelledError')
  })
})
