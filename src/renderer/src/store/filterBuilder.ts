import { quoteIdent } from '../../../shared/sqlIdent'
import type { FilterCondition, TableSort } from '../../../shared/types'

function inItems(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// LIKE のメタ文字（% _ とエスケープ文字 \）を打ち消し、ユーザー入力を「リテラルとして含む」検索にする。
// MySQL 既定のエスケープ文字は \ なので ESCAPE 句は不要。
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

// SQL に直接埋め込む比較演算子の許可リスト（型システムを回避したキャストへの実行時防御）
const COMPARISON_OPS: ReadonlySet<string> = new Set(['=', '<>', '<', '>', '<=', '>='])

function isUsable(c: FilterCondition, columns: string[]): boolean {
  if (!c.enabled) return false
  if (!columns.includes(c.column)) return false
  switch (c.operator) {
    case 'is_null':
    case 'is_not_null':
      return true
    case 'between':
      return c.value.trim() !== '' && c.value2.trim() !== ''
    case 'in':
      return inItems(c.value).length > 0
    default:
      return c.value.trim() !== ''
  }
}

function clauseFor(c: FilterCondition): { clause: string; params: unknown[] } {
  const col = quoteIdent(c.column)
  switch (c.operator) {
    case 'is_null':
      return { clause: `${col} IS NULL`, params: [] }
    case 'is_not_null':
      return { clause: `${col} IS NOT NULL`, params: [] }
    case 'contains':
      return { clause: `${col} LIKE ?`, params: [`%${escapeLike(c.value)}%`] }
    case 'not_contains':
      return { clause: `${col} NOT LIKE ?`, params: [`%${escapeLike(c.value)}%`] }
    case 'in': {
      const items = inItems(c.value)
      return { clause: `${col} IN (${items.map(() => '?').join(', ')})`, params: items }
    }
    case 'between':
      return { clause: `${col} BETWEEN ? AND ?`, params: [c.value, c.value2] }
    default:
      // '=', '<>', '<', '>', '<=', '>='。演算子は SQL に直接埋め込むため許可リストで実行時検証する。
      if (!COMPARISON_OPS.has(c.operator)) {
        throw new Error(`Unexpected filter operator: ${c.operator}`)
      }
      return { clause: `${col} ${c.operator} ?`, params: [c.value] }
  }
}

// WHERE 句と params を生成（ページ用クエリと COUNT クエリで共有）。
function buildWhere(
  columns: string[],
  conditions: FilterCondition[]
): { where: string; params: unknown[] } {
  const parts = conditions.filter((c) => isUsable(c, columns)).map(clauseFor)
  const where = parts.map((p) => p.clause).join(' AND ')
  const params = parts.flatMap((p) => p.params)
  return { where, params }
}

// LIMIT/OFFSET を SQL に直接埋め込むためのガード（非負整数のみ受理し、それ以外は fallback）。
function safeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

// ORDER BY 句を生成。sort が null かカラムがホワイトリスト外なら空文字。
function orderByClause(columns: string[], sort?: TableSort | null): string {
  if (!sort || !columns.includes(sort.column)) return ''
  const dir = sort.dir === 'desc' ? 'DESC' : 'ASC'
  return `${quoteIdent(sort.column)} ${dir}`
}

export interface PageOptions {
  sort?: TableSort | null
  limit?: number | null // null = LIMIT なし（全件）
  offset?: number
}

/**
 * フィルター条件からパラメータ化された SELECT を組み立てる。値は必ず `?` プレースホルダに入り、
 * 識別子（table/column）はバッククォートで囲み内部のバッククォートを2重化してエスケープする。
 * sort 列はカラム・ホワイトリストで検証し、limit/offset は非負整数のみ埋め込む。
 * @param table スキーマ由来の信頼できるテーブル名（ユーザー入力をそのまま渡さないこと）。
 * @param columns フィルター/ソート可能なカラムのホワイトリスト。
 * @param options sort/limit/offset。省略時は ORDER BY なし・LIMIT 100・OFFSET なし。
 *   limit が null のときは LIMIT を付けず全件取得し、OFFSET も無視される（MySQL では LIMIT なしの OFFSET が無効なため）。
 */
export function buildFilteredQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[],
  options?: PageOptions
): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(columns, conditions)
  const orderBy = orderByClause(columns, options?.sort)
  const unlimited = options?.limit === null
  const limit = safeInt(options?.limit, 100)
  const offset = safeInt(options?.offset, 0)
  const sql =
    `SELECT * FROM ${quoteIdent(table)}` +
    (where ? ` WHERE ${where}` : '') +
    (orderBy ? ` ORDER BY ${orderBy}` : '') +
    (unlimited ? '' : ` LIMIT ${limit}`) +
    (!unlimited && offset > 0 ? ` OFFSET ${offset}` : '')
  return { sql, params }
}

/**
 * 同じフィルター条件に対する総件数クエリ（ORDER BY / LIMIT は付けない）。params は WHERE と一致。
 */
export function buildCountQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[]
): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(columns, conditions)
  const sql = `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}${where ? ` WHERE ${where}` : ''}`
  return { sql, params }
}

// 2つの条件集合が同じ WHERE 効果（適用しても結果が変わらない）かを判定する。
// 内部の buildWhere を再利用し where 文字列と params の一致で比較するため、
// id の違い・無効化・空値など結果に影響しない差分は自動的に無視される。
export function sameFilterEffect(
  columns: string[],
  a: FilterCondition[],
  b: FilterCondition[]
): boolean {
  const wa = buildWhere(columns, a)
  const wb = buildWhere(columns, b)
  return wa.where === wb.where && JSON.stringify(wa.params) === JSON.stringify(wb.params)
}

// 有効かつ実効のある（isUsable な）条件の件数。適用中バッジ用。
export function countUsableFilters(columns: string[], conditions: FilterCondition[]): number {
  return conditions.filter((c) => isUsable(c, columns)).length
}
