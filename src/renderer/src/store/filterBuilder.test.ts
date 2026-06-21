import { describe, expect, it } from 'vitest'
import type { FilterCondition } from '../../../shared/types'
import {
  buildCountQuery,
  buildFilteredQuery,
  countUsableFilters,
  sameFilterEffect
} from './filterBuilder'

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
    const r = buildFilteredQuery(
      'we`ird',
      ['c`ol'],
      [{ ...base, column: 'c`ol', operator: 'is_null' }]
    )
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

  it('limit: null は LIMIT を付けない（全件）', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: null })
    expect(r.sql).toBe('SELECT * FROM `t`')
  })

  it('limit: null でも WHERE / ORDER BY は付く（OFFSET は付かない）', () => {
    const r = buildFilteredQuery(
      't',
      cols,
      [{ id: 'x', enabled: true, value: '5', value2: '', column: 'id', operator: '=' }],
      { sort: { column: 'name', dir: 'asc' }, limit: null, offset: 100 }
    )
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? ORDER BY `name` ASC')
    expect(r.params).toEqual(['5'])
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

describe('sameFilterEffect', () => {
  const cols = ['id', 'name']
  const f = (over: Partial<FilterCondition>): FilterCondition => ({
    id: 'x',
    enabled: true,
    column: 'id',
    operator: '=',
    value: '',
    value2: '',
    ...over
  })

  it('id だけ違う同内容は true', () => {
    expect(sameFilterEffect(cols, [f({ id: 'a', value: '5' })], [f({ id: 'b', value: '5' })])).toBe(
      true
    )
  })
  it('無効化された条件の有無は効果に影響しない（true）', () => {
    const a = [f({ value: '5' })]
    const b = [
      f({ value: '5' }),
      f({ column: 'name', operator: 'contains', value: 'z', enabled: false })
    ]
    expect(sameFilterEffect(cols, a, b)).toBe(true)
  })
  it('空値の条件追加は効果なし（true）', () => {
    const a = [f({ value: '5' })]
    const b = [f({ value: '5' }), f({ column: 'name', operator: '=', value: '' })]
    expect(sameFilterEffect(cols, a, b)).toBe(true)
  })
  it('値の変更は false', () => {
    expect(sameFilterEffect(cols, [f({ value: '5' })], [f({ value: '6' })])).toBe(false)
  })
  it('演算子の変更は false', () => {
    expect(
      sameFilterEffect(
        cols,
        [f({ value: '5', operator: '=' })],
        [f({ value: '5', operator: '<>' })]
      )
    ).toBe(false)
  })
  it('列の変更は false', () => {
    expect(
      sameFilterEffect(cols, [f({ column: 'id', value: '5' })], [f({ column: 'name', value: '5' })])
    ).toBe(false)
  })
  it('ホワイトリスト外の列を含む差分は無視（true）', () => {
    const a = [f({ value: '5' })]
    const b = [f({ value: '5' }), f({ column: 'evil', value: 'z' })]
    expect(sameFilterEffect(cols, a, b)).toBe(true)
  })
})

describe('countUsableFilters', () => {
  const cols = ['id', 'name']
  const f = (over: Partial<FilterCondition>): FilterCondition => ({
    id: 'x',
    enabled: true,
    column: 'id',
    operator: '=',
    value: '',
    value2: '',
    ...over
  })

  it('有効＋実効のある条件のみ数える', () => {
    const list = [
      f({ value: '5' }),
      f({ column: 'name', operator: 'contains', value: 'a' }),
      f({ value: '9', enabled: false }),
      f({ column: 'name', operator: '=', value: '' }),
      f({ column: 'evil', value: 'z' })
    ]
    expect(countUsableFilters(cols, list)).toBe(2)
  })
  it('is_null は値なしでも実効ありとして数える', () => {
    expect(countUsableFilters(cols, [f({ operator: 'is_null', value: '' })])).toBe(1)
    expect(countUsableFilters(cols, [f({ operator: 'is_not_null', value: '' })])).toBe(1)
  })
  it('0 件は 0', () => {
    expect(countUsableFilters(cols, [])).toBe(0)
  })
})
