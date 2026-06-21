import { describe, it, expect } from 'vitest'
import { classifyStatement, classifyScript } from './classifyStatement'

describe('classifyStatement', () => {
  it('SELECT/SHOW/EXPLAIN/DESCRIBE/USE/SET は readonly', () => {
    expect(classifyStatement('SELECT * FROM users')).toBe('readonly')
    expect(classifyStatement('SHOW TABLES')).toBe('readonly')
    expect(classifyStatement('EXPLAIN SELECT 1')).toBe('readonly')
    expect(classifyStatement('DESCRIBE users')).toBe('readonly')
    expect(classifyStatement('USE mydb')).toBe('readonly')
    expect(classifyStatement('SET @x = 1')).toBe('readonly')
  })
  it('INSERT/UPDATE/DELETE/ALTER/CREATE/CALL は write', () => {
    expect(classifyStatement('INSERT INTO t VALUES (1)')).toBe('write')
    expect(classifyStatement('UPDATE t SET a=1')).toBe('write')
    expect(classifyStatement('DELETE FROM t')).toBe('write')
    expect(classifyStatement('ALTER TABLE t ADD c INT')).toBe('write')
    expect(classifyStatement('CREATE TABLE t (id INT)')).toBe('write')
    expect(classifyStatement('CALL my_proc()')).toBe('write')
  })
  it('DROP/TRUNCATE は catastrophic', () => {
    expect(classifyStatement('DROP TABLE t')).toBe('catastrophic')
    expect(classifyStatement('TRUNCATE TABLE t')).toBe('catastrophic')
    expect(classifyStatement('DROP DATABASE d')).toBe('catastrophic')
  })
  it('先頭の空白・小文字・開き括弧を吸収する', () => {
    expect(classifyStatement('  drop table t')).toBe('catastrophic')
    expect(classifyStatement('(SELECT 1)')).toBe('readonly')
  })
  it('WITH (CTE) 始まりは write 扱い（本番ガードを迂回させない）', () => {
    expect(classifyStatement('WITH cte AS (SELECT 1) DELETE FROM t')).toBe('write')
    expect(classifyStatement('WITH cte AS (SELECT 1) UPDATE t SET a=1')).toBe('write')
    expect(classifyStatement('WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte')).toBe(
      'write'
    )
  })
  it('先頭コメント付きの破壊的文を迂回させない（実キーワードで判定）', () => {
    expect(classifyStatement('-- 古いテーブルを削除\nDROP TABLE users')).toBe('catastrophic')
    expect(classifyStatement('# cleanup\nTRUNCATE TABLE orders')).toBe('catastrophic')
    expect(classifyStatement('/* cleanup */ DROP TABLE t')).toBe('catastrophic')
    expect(classifyStatement('/* a */ -- b\n  DELETE FROM t')).toBe('write')
    expect(classifyStatement('-- 単なるコメント\nSELECT 1')).toBe('readonly')
  })
  it('コメントのみ・空文字は readonly', () => {
    expect(classifyStatement('')).toBe('readonly')
    expect(classifyStatement('-- comment only')).toBe('readonly')
    expect(classifyStatement('/* block only */')).toBe('readonly')
  })
})

describe('classifyScript', () => {
  it('複数文の最大ティアを返す（SELECT + DROP → catastrophic）', () => {
    expect(classifyScript('SELECT 1; DROP TABLE t;')).toBe('catastrophic')
  })
  it('SELECT + UPDATE → write', () => {
    expect(classifyScript('SELECT 1; UPDATE t SET a=1;')).toBe('write')
  })
  it('SELECT のみ → readonly', () => {
    expect(classifyScript('SELECT 1; SELECT 2;')).toBe('readonly')
  })
  it('空文字・空白のみ → readonly', () => {
    expect(classifyScript('   ')).toBe('readonly')
  })
  it('WITH 始まりの DML を含むスクリプトは write 以上', () => {
    expect(classifyScript('WITH cte AS (SELECT 1) DELETE FROM t')).toBe('write')
  })
  it('コメント始まりの破壊的文を含むスクリプトを迂回させない', () => {
    expect(classifyScript('SELECT 1; -- c\nDROP TABLE t;')).toBe('catastrophic')
    expect(classifyScript('/* x */ TRUNCATE TABLE t;')).toBe('catastrophic')
  })
})
