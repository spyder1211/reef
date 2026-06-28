// mysql2 の query 戻り値（rows）から、データ行と影響行数を取り出す純関数。
// SELECT は行配列 → dataRows=配列, affectedRows=undefined。
// 非SELECT（UPDATE/INSERT/DELETE/DDL）は ResultSetHeader（配列でない）→ dataRows=[],
// affectedRows=header.affectedRows。
export function extractRows(rows: unknown): {
  dataRows: Record<string, unknown>[]
  affectedRows?: number
} {
  if (Array.isArray(rows)) {
    return { dataRows: rows as Record<string, unknown>[] }
  }
  const header = rows as { affectedRows?: number } | null
  return { dataRows: [], affectedRows: header?.affectedRows }
}
