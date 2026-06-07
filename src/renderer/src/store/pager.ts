import type { TableSort } from '../../../shared/types'

// 総ページ数。total が null（COUNT 未取得/失敗）なら null。0 件でも最小 1 ページ。
export function totalPages(total: number | null, pageSize: number): number | null {
  if (total === null) return null
  if (total <= 0) return 1
  return Math.ceil(total / pageSize)
}

// 現在ページの表示範囲 {start, end}（1 始まり）。返却 0 件なら {0, 0}。
export function pageRange(
  page: number,
  pageSize: number,
  returned: number
): { start: number; end: number } {
  if (returned <= 0) return { start: 0, end: 0 }
  const start = page * pageSize + 1
  return { start, end: page * pageSize + returned }
}

// 「次へ」可否。total があれば最終ページ判定、なければ返却行数==pageSize で判定（劣化動作）。
export function canGoNext(
  page: number,
  pageSize: number,
  total: number | null,
  returned: number
): boolean {
  const pages = totalPages(total, pageSize)
  if (pages === null) return returned === pageSize
  return page + 1 < pages
}

// ヘッダクリック時のソート巡回:
//  別の列 → その列の昇順 / 同じ列の昇順 → 降順 / 同じ列の降順 → 解除(null)
export function cycleSort(current: TableSort | null, column: string): TableSort | null {
  if (!current || current.column !== column) return { column, dir: 'asc' }
  if (current.dir === 'asc') return { column, dir: 'desc' }
  return null
}
