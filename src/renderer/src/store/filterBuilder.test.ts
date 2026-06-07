import { describe, it, expect } from 'vitest'
import { buildFilteredQuery, buildCountQuery } from './filterBuilder'
import type { FilterCondition } from '../../../shared/types'

const cols = ['id', 'name', 'date']
const base: Omit<FilterCondition, 'column' | 'operator'> = {
  id: 'x',
  enabled: true,
  value: '',
  value2: ''
}

describe('buildFilteredQuery', () => {
  it('フィルタなしは素のSELECT', () => {
    expect(buildFilteredQuery('t', cols, [])).toEqual({
      sql: 'SELECT * FROM `t` LIMIT 100',
      params: []
    })
  })

  it('= は ? プレースホルダ', () => {
    const r = buildFilteredQuery('t', cols, [{ ...base, column: 'id', operator: '=', value: '5' }])
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? LIMIT 100')
    expect(r.params).toEqual(['5'])
  })

  it('含む は LIKE %v%', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'name', operator: 'contains', value: 'ab' }
    ])
    expect(r.sql).toContain('`name` LIKE ?')
    expect(r.params).toEqual(['%ab%'])
  })

  it('含まない は NOT LIKE', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'name', operator: 'not_contains', value: 'ab' }
    ])
    expect(r.sql).toContain('`name` NOT LIKE ?')
    expect(r.params).toEqual(['%ab%'])
  })

  it('含む の値の LIKE メタ文字(% _ \\)をエスケープする', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'name', operator: 'contains', value: '50%_a\\b' }
    ])
    expect(r.sql).toContain('`name` LIKE ?')
    expect(r.params).toEqual(['%50\\%\\_a\\\\b%'])
  })

  it('IS NULL は値なし', () => {
    const r = buildFilteredQuery('t', cols, [{ ...base, column: 'name', operator: 'is_null' }])
    expect(r.sql).toContain('`name` IS NULL')
    expect(r.params).toEqual([])
  })

  it('IS NOT NULL は値なし', () => {
    const r = buildFilteredQuery('t', cols, [{ ...base, column: 'name', operator: 'is_not_null' }])
    expect(r.sql).toContain('`name` IS NOT NULL')
    expect(r.params).toEqual([])
  })

  it('<> も default 分岐で ? を生成', () => {
    const r = buildFilteredQuery('t', cols, [{ ...base, column: 'id', operator: '<>', value: '3' }])
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` <> ? LIMIT 100')
    expect(r.params).toEqual(['3'])
  })

  it('IN はカンマ分割で複数 ?（空要素除去）', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'id', operator: 'in', value: '1, 2 , ,3' }
    ])
    expect(r.sql).toContain('`id` IN (?, ?, ?)')
    expect(r.params).toEqual(['1', '2', '3'])
  })

  it('BETWEEN は2つの ?', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'date', operator: 'between', value: 'a', value2: 'b' }
    ])
    expect(r.sql).toContain('`date` BETWEEN ? AND ?')
    expect(r.params).toEqual(['a', 'b'])
  })

  it('複数行は AND 結合', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'id', operator: '=', value: '1' },
      { ...base, column: 'name', operator: 'contains', value: 'x' }
    ])
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? AND `name` LIKE ? LIMIT 100')
    expect(r.params).toEqual(['1', '%x%'])
  })

  it('無効行/空値/未知カラム/値不足BETWEEN/空INはスキップ', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'id', operator: '=', value: '1', enabled: false },
      { ...base, column: 'name', operator: '=', value: '' },
      { ...base, column: 'unknown', operator: '=', value: 'z' },
      { ...base, column: 'date', operator: 'between', value: 'a', value2: '' },
      { ...base, column: 'id', operator: 'in', value: ' , ' }
    ])
    expect(r).toEqual({ sql: 'SELECT * FROM `t` LIMIT 100', params: [] })
  })

  it('識別子のバッククォートを2重化してエスケープ', () => {
    const r = buildFilteredQuery('we`ird', ['c`ol'], [
      { ...base, column: 'c`ol', operator: 'is_null' }
    ])
    expect(r.sql).toBe('SELECT * FROM `we``ird` WHERE `c``ol` IS NULL LIMIT 100')
  })
})

describe('buildFilteredQuery options (sort/limit/offset)', () => {
  it('sort を渡すと ORDER BY を付ける（asc）', () => {
    const r = buildFilteredQuery('t', cols, [], { sort: { column: 'name', dir: 'asc' } })
    expect(r.sql).toBe('SELECT * FROM `t` ORDER BY `name` ASC LIMIT 100')
  })

  it('sort desc は ORDER BY ... DESC', () => {
    const r = buildFilteredQuery('t', cols, [], { sort: { column: 'date', dir: 'desc' } })
    expect(r.sql).toBe('SELECT * FROM `t` ORDER BY `date` DESC LIMIT 100')
  })

  it('ホワイトリスト外のソート列は ORDER BY を付けない', () => {
    const r = buildFilteredQuery('t', cols, [], { sort: { column: 'evil', dir: 'asc' } })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('ソート列の識別子をバッククォートでエスケープ', () => {
    const r = buildFilteredQuery('t', ['c`ol'], [], { sort: { column: 'c`ol', dir: 'asc' } })
    expect(r.sql).toBe('SELECT * FROM `t` ORDER BY `c``ol` ASC LIMIT 100')
  })

  it('limit を反映する', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 50 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 50')
  })

  it('offset > 0 のとき OFFSET を付ける', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 100, offset: 200 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100 OFFSET 200')
  })

  it('offset 0 のときは OFFSET を付けない', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 100, offset: 0 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('limit/offset が整数でなければ既定値にフォールバック', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 1.5, offset: -3 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('WHERE + ORDER BY + LIMIT + OFFSET の順で結合する', () => {
    const r = buildFilteredQuery(
      't',
      cols,
      [{ id: 'x', enabled: true, value: '5', value2: '', column: 'id', operator: '=' }],
      { sort: { column: 'name', dir: 'asc' }, limit: 100, offset: 100 }
    )
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? ORDER BY `name` ASC LIMIT 100 OFFSET 100')
    expect(r.params).toEqual(['5'])
  })
})

describe('buildCountQuery', () => {
  it('フィルタなしは素の COUNT', () => {
    expect(buildCountQuery('t', cols, [])).toEqual({
      sql: 'SELECT COUNT(*) AS total FROM `t`',
      params: []
    })
  })

  it('WHERE 付きで params が一致する', () => {
    const r = buildCountQuery('t', cols, [
      { id: 'x', enabled: true, value: '5', value2: '', column: 'id', operator: '=' }
    ])
    expect(r.sql).toBe('SELECT COUNT(*) AS total FROM `t` WHERE `id` = ?')
    expect(r.params).toEqual(['5'])
  })
})
