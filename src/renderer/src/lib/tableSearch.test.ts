import { describe, it, expect } from 'vitest'
import { filterTables, matchRange } from './tableSearch'

describe('filterTables', () => {
  const tables = ['users', 'user_roles', 'orders', 'ORDER_items', 'audit_log']

  it('空クエリは全件をそのまま返す', () => {
    expect(filterTables(tables, '')).toEqual(tables)
  })
  it('空白のみクエリも全件', () => {
    expect(filterTables(tables, '   ')).toEqual(tables)
  })
  it('大文字小文字を無視して部分一致', () => {
    expect(filterTables(tables, 'user')).toEqual(['users', 'user_roles'])
    expect(filterTables(tables, 'ORDER')).toEqual(['orders', 'ORDER_items'])
  })
  it('一致しないものは除外', () => {
    expect(filterTables(tables, 'xyz')).toEqual([])
  })
  it('特殊文字は literal 扱い（正規表現にならない）', () => {
    expect(filterTables(['a.b', 'axb', 'a_b'], '.')).toEqual(['a.b'])
    expect(filterTables(['a_b', 'axb'], '_')).toEqual(['a_b'])
  })
  it('前後空白はトリムして一致', () => {
    expect(filterTables(tables, '  user  ')).toEqual(['users', 'user_roles'])
  })
})

describe('matchRange', () => {
  it('先頭一致', () => {
    expect(matchRange('users', 'use')).toEqual({ start: 0, end: 3 })
  })
  it('中間一致', () => {
    expect(matchRange('user_roles', 'rol')).toEqual({ start: 5, end: 8 })
  })
  it('末尾一致', () => {
    expect(matchRange('audit_log', 'log')).toEqual({ start: 6, end: 9 })
  })
  it('大文字小文字を無視', () => {
    expect(matchRange('ORDER_items', 'order')).toEqual({ start: 0, end: 5 })
  })
  it('空クエリ・空白のみは null', () => {
    expect(matchRange('users', '')).toBeNull()
    expect(matchRange('users', '   ')).toBeNull()
  })
  it('一致なしは null', () => {
    expect(matchRange('users', 'xyz')).toBeNull()
  })
  it('前後空白付きクエリでも end-start はトリム後の長さ', () => {
    expect(matchRange('user_roles', '  rol  ')).toEqual({ start: 5, end: 8 })
  })
})
