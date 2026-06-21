import { describe, expect, it } from 'vitest'
import type { PendingInsert, RowEdit } from '../../../shared/types'
import {
  buildDeleteStatements,
  buildDropStatement,
  buildInsertStatements,
  buildTruncateStatement,
  buildUpdateStatements
} from './editBuilder'

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

describe('buildInsertStatements', () => {
  it('単一列 INSERT', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: '山田' } }]
    expect(buildInsertStatements('users', inserts)).toEqual([
      { sql: 'INSERT INTO `users` (`name`) VALUES (?)', params: ['山田'] }
    ])
  })

  it('複数列 INSERT', () => {
    const inserts: PendingInsert[] = [
      { localId: 'ins-0', values: { name: '太郎', email: 'a@b.com' } }
    ]
    const r = buildInsertStatements('users', inserts)
    expect(r[0].sql).toBe('INSERT INTO `users` (`name`, `email`) VALUES (?, ?)')
    expect(r[0].params).toEqual(['太郎', 'a@b.com'])
  })

  it('空文字の列は SQL から除外', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: '太郎', email: '' } }]
    const r = buildInsertStatements('users', inserts)
    expect(r[0].sql).toBe('INSERT INTO `users` (`name`) VALUES (?)')
    expect(r[0].params).toEqual(['太郎'])
  })

  it('null 値は param が null', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: null } }]
    const r = buildInsertStatements('users', inserts)
    expect(r[0].params).toEqual([null])
  })

  it('識別子のバッククォートを2重化', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { 'c`ol': 'v' } }]
    const r = buildInsertStatements('we`ird', inserts)
    expect(r[0].sql).toBe('INSERT INTO `we``ird` (`c``ol`) VALUES (?)')
  })

  it('values がすべて空文字の行はスキップ', () => {
    const inserts: PendingInsert[] = [
      { localId: 'ins-0', values: { name: '', email: '' } },
      { localId: 'ins-1', values: { name: '花子' } }
    ]
    const r = buildInsertStatements('users', inserts)
    expect(r).toHaveLength(1)
    expect(r[0].params).toEqual(['花子'])
  })

  it('inserts が空なら空配列', () => {
    expect(buildInsertStatements('users', [])).toEqual([])
  })
})

describe('buildDeleteStatements', () => {
  it('単一 PK の DELETE', () => {
    const deletes = { k1: { id: 6 } }
    expect(buildDeleteStatements('users', ['id'], deletes)).toEqual([
      { sql: 'DELETE FROM `users` WHERE `id` = ?', params: [6] }
    ])
  })

  it('複合 PK は WHERE を AND 結合', () => {
    const deletes = { k1: { a: 1, b: 2 } }
    const r = buildDeleteStatements('t', ['a', 'b'], deletes)
    expect(r[0].sql).toBe('DELETE FROM `t` WHERE `a` = ? AND `b` = ?')
    expect(r[0].params).toEqual([1, 2])
  })

  it('識別子のバッククォートを2重化', () => {
    const deletes = { k1: { 'i`d': 3 } }
    const r = buildDeleteStatements('we`ird', ['i`d'], deletes)
    expect(r[0].sql).toBe('DELETE FROM `we``ird` WHERE `i``d` = ?')
  })

  it('primaryKey 空なら空配列', () => {
    expect(buildDeleteStatements('t', [], { k: { id: 1 } })).toEqual([])
  })

  it('deletes が空なら空配列', () => {
    expect(buildDeleteStatements('t', ['id'], {})).toEqual([])
  })
})

describe('buildTruncateStatement', () => {
  it('TRUNCATE 文を組む', () => {
    expect(buildTruncateStatement('users')).toEqual({
      sql: 'TRUNCATE TABLE `users`',
      params: []
    })
  })

  it('識別子のバッククォートを2重化', () => {
    expect(buildTruncateStatement('we`ird')).toEqual({
      sql: 'TRUNCATE TABLE `we``ird`',
      params: []
    })
  })
})

describe('buildDropStatement', () => {
  it('DROP 文を組む', () => {
    expect(buildDropStatement('users')).toEqual({
      sql: 'DROP TABLE `users`',
      params: []
    })
  })

  it('識別子のバッククォートを2重化', () => {
    expect(buildDropStatement('we`ird')).toEqual({
      sql: 'DROP TABLE `we``ird`',
      params: []
    })
  })
})
