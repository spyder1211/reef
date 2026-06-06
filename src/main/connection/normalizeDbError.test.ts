import { describe, it, expect } from 'vitest'
import { normalizeDbError } from './normalizeDbError'

describe('normalizeDbError', () => {
  it('mysql2 のエラー(code + sqlMessage)を整形', () => {
    const err = { code: 'ER_ACCESS_DENIED_ERROR', sqlMessage: "Access denied for user 'root'" }
    expect(normalizeDbError(err)).toEqual({
      code: 'ER_ACCESS_DENIED_ERROR',
      message: "Access denied for user 'root'"
    })
  })

  it('通常の Error は message を使い code は UNKNOWN', () => {
    expect(normalizeDbError(new Error('boom'))).toEqual({ code: 'UNKNOWN', message: 'boom' })
  })

  it('未知の値は文字列化', () => {
    expect(normalizeDbError('x')).toEqual({ code: 'UNKNOWN', message: 'x' })
  })
})
