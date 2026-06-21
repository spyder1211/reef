import { describe, expect, it } from 'vitest'
import { singleStatementOf } from './explain'

describe('singleStatementOf', () => {
  it('末尾セミコロンを除去して返す', () => {
    expect(singleStatementOf('SELECT 1;')).toBe('SELECT 1')
  })
  it('セミコロン無しはそのまま', () => {
    expect(singleStatementOf('  SELECT 1  ')).toBe('SELECT 1')
  })
  it('複数文は null', () => {
    expect(singleStatementOf('SELECT 1; SELECT 2;')).toBeNull()
  })
  it('空文字は null', () => {
    expect(singleStatementOf('  ;  ')).toBeNull()
  })
})
