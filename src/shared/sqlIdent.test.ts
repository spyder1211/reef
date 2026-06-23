import { describe, expect, it } from 'vitest'
import { quoteIdent } from './sqlIdent'

describe('quoteIdent', () => {
  it('通常の識別子をバッククォートで囲む', () => {
    expect(quoteIdent('id')).toBe('`id`')
    expect(quoteIdent('user_name')).toBe('`user_name`')
  })
  it('内部のバッククォートを2重化する（SQLi 防御）', () => {
    expect(quoteIdent('a`b')).toBe('`a``b`')
    expect(quoteIdent('`')).toBe('````')
  })
  it('空文字は空のバッククォート対', () => {
    expect(quoteIdent('')).toBe('``')
  })
})
