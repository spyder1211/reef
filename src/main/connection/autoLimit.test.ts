import { describe, it, expect } from 'vitest'
import { maybeApplyAutoLimit } from './autoLimit'

describe('maybeApplyAutoLimit', () => {
  it('単一の素SELECTに LIMIT 500 を付与する', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM users', 1)).toEqual({
      sql: 'SELECT * FROM users LIMIT 500',
      applied: true
    })
  })

  it('小文字 select でも付与する（大小無視）', () => {
    expect(maybeApplyAutoLimit('select * from t', 1).applied).toBe(true)
  })

  it('ORDER BY の後ろに付与する', () => {
    expect(maybeApplyAutoLimit('SELECT id FROM t ORDER BY id DESC', 1).sql).toBe(
      'SELECT id FROM t ORDER BY id DESC LIMIT 500'
    )
  })

  it('トップレベル LIMIT があれば付与しない', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM t LIMIT 10', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('SELECT * FROM t LIMIT 5, 10', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('SELECT * FROM t LIMIT 10 OFFSET 5', 1).applied).toBe(false)
  })

  it('サブクエリ内の LIMIT のみなら付与する（トップレベルには無い）', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM (SELECT id FROM t LIMIT 5) x', 1).applied).toBe(true)
  })

  it('WITH … SELECT（CTE）に付与する', () => {
    expect(maybeApplyAutoLimit('WITH c AS (SELECT 1 AS n) SELECT * FROM c', 1).applied).toBe(true)
  })

  it('WITH … UPDATE には付与しない', () => {
    expect(maybeApplyAutoLimit('WITH c AS (SELECT id FROM t) UPDATE t SET x = 1', 1).applied).toBe(
      false
    )
  })

  it('SELECT 以外（SHOW/DESCRIBE/INSERT/UPDATE）には付与しない', () => {
    expect(maybeApplyAutoLimit('SHOW TABLES', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('DESCRIBE t', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('INSERT INTO t VALUES (1)', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('UPDATE t SET x = 1', 1).applied).toBe(false)
  })

  it('複数文には付与しない', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM t', 2).applied).toBe(false)
  })

  it('文字列リテラル内の括弧やキーワードに惑わされない', () => {
    expect(maybeApplyAutoLimit("SELECT * FROM t WHERE name = 'a (limit) b'", 1)).toEqual({
      sql: "SELECT * FROM t WHERE name = 'a (limit) b' LIMIT 500",
      applied: true
    })
  })

  it('不正・空SQLでも例外を投げず applied=false', () => {
    expect(maybeApplyAutoLimit('', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('))(( garbage', 1).applied).toBe(false)
  })
})
