import { describe, expect, it } from 'vitest'
import { canGoNext, cycleSort, pageRange, totalPages } from './pager'

describe('totalPages', () => {
  it('total が null なら null', () => {
    expect(totalPages(null, 100)).toBeNull()
  })
  it('0 件でも 1 ページ', () => {
    expect(totalPages(0, 100)).toBe(1)
  })
  it('端数は切り上げ', () => {
    expect(totalPages(250, 100)).toBe(3)
    expect(totalPages(200, 100)).toBe(2)
  })
})

describe('pageRange', () => {
  it('1 ページ目', () => {
    expect(pageRange(0, 100, 100)).toEqual({ start: 1, end: 100 })
  })
  it('3 ページ目の端数', () => {
    expect(pageRange(2, 100, 45)).toEqual({ start: 201, end: 245 })
  })
  it('返却 0 件なら 0-0', () => {
    expect(pageRange(0, 100, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('canGoNext', () => {
  it('total ありで最終ページ手前は true', () => {
    expect(canGoNext(0, 100, 250, 100)).toBe(true)
  })
  it('total ありで最終ページは false', () => {
    expect(canGoNext(2, 100, 250, 50)).toBe(false)
  })
  it('total が null なら 返却==pageSize で判定', () => {
    expect(canGoNext(0, 100, null, 100)).toBe(true)
    expect(canGoNext(0, 100, null, 40)).toBe(false)
  })
})

describe('cycleSort', () => {
  it('別の列は昇順から始まる', () => {
    expect(cycleSort(null, 'a')).toEqual({ column: 'a', dir: 'asc' })
    expect(cycleSort({ column: 'b', dir: 'desc' }, 'a')).toEqual({ column: 'a', dir: 'asc' })
  })
  it('同じ列は 昇順 → 降順', () => {
    expect(cycleSort({ column: 'a', dir: 'asc' }, 'a')).toEqual({ column: 'a', dir: 'desc' })
  })
  it('同じ列の降順は解除（null）', () => {
    expect(cycleSort({ column: 'a', dir: 'desc' }, 'a')).toBeNull()
  })
})
