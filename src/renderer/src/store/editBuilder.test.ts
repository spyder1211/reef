import { describe, it, expect } from 'vitest'
import { buildUpdateStatements } from './editBuilder'
import type { RowEdit } from '../../../shared/types'

describe('buildUpdateStatements', () => {
  it('単一列 UPDATE', () => {
    const edits: RowEdit[] = [{ pk: { id: 1 }, values: { name: '山田' } }]
    expect(buildUpdateStatements('users', ['id'], edits)).toEqual([
      { sql: 'UPDATE `users` SET `name` = ? WHERE `id` = ?', params: ['山田', 1] }
    ])
  })

  it('複数列 UPDATE', () => {
    const edits: RowEdit[] = [{ pk: { id: 2 }, values: { name: '太郎', status: 'x' } }]
    const r = buildUpdateStatements('users', ['id'], edits)
    expect(r[0].sql).toBe('UPDATE `users` SET `name` = ?, `status` = ? WHERE `id` = ?')
    expect(r[0].params).toEqual(['太郎', 'x', 2])
  })

  it('複合主キーは WHERE を AND 結合し pk 値を使う', () => {
    const edits: RowEdit[] = [{ pk: { a: 1, b: 2 }, values: { n: '9' } }]
    const r = buildUpdateStatements('t', ['a', 'b'], edits)
    expect(r[0].sql).toBe('UPDATE `t` SET `n` = ? WHERE `a` = ? AND `b` = ?')
    expect(r[0].params).toEqual(['9', 1, 2])
  })

  it('NULL 値は param が null', () => {
    const edits: RowEdit[] = [{ pk: { id: 1 }, values: { name: null } }]
    const r = buildUpdateStatements('t', ['id'], edits)
    expect(r[0].params).toEqual([null, 1])
  })

  it('識別子のバッククォートを2重化', () => {
    const edits: RowEdit[] = [{ pk: { 'i`d': 1 }, values: { 'c`ol': 'v' } }]
    const r = buildUpdateStatements('we`ird', ['i`d'], edits)
    expect(r[0].sql).toBe('UPDATE `we``ird` SET `c``ol` = ? WHERE `i``d` = ?')
  })

  it('values 空の行はスキップ', () => {
    const edits: RowEdit[] = [
      { pk: { id: 1 }, values: {} },
      { pk: { id: 2 }, values: { n: '1' } }
    ]
    const r = buildUpdateStatements('t', ['id'], edits)
    expect(r).toHaveLength(1)
    expect(r[0].params).toEqual(['1', 2])
  })

  it('主キー空なら空配列', () => {
    expect(buildUpdateStatements('t', [], [{ pk: {}, values: { n: '1' } }])).toEqual([])
  })

  it('PK 列を編集しても WHERE はオリジナル pk 値を使う', () => {
    const edits: RowEdit[] = [{ pk: { id: 1 }, values: { id: '99' } }]
    const r = buildUpdateStatements('t', ['id'], edits)
    expect(r[0].sql).toBe('UPDATE `t` SET `id` = ? WHERE `id` = ?')
    expect(r[0].params).toEqual(['99', 1])
  })
})
