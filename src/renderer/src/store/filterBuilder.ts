import type { FilterCondition } from '../../../shared/types'

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

function inItems(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

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
      return { clause: `${col} LIKE ?`, params: [`%${c.value}%`] }
    case 'not_contains':
      return { clause: `${col} NOT LIKE ?`, params: [`%${c.value}%`] }
    case 'in': {
      const items = inItems(c.value)
      return { clause: `${col} IN (${items.map(() => '?').join(', ')})`, params: items }
    }
    case 'between':
      return { clause: `${col} BETWEEN ? AND ?`, params: [c.value, c.value2] }
    default:
      // '=', '<>', '<', '>', '<=', '>='
      return { clause: `${col} ${c.operator} ?`, params: [c.value] }
  }
}

export function buildFilteredQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[]
): { sql: string; params: unknown[] } {
  const parts = conditions.filter((c) => isUsable(c, columns)).map(clauseFor)
  const where = parts.map((p) => p.clause).join(' AND ')
  const params = parts.flatMap((p) => p.params)
  const sql = `SELECT * FROM ${quoteIdent(table)}` + (where ? ` WHERE ${where}` : '') + ` LIMIT 100`
  return { sql, params }
}
