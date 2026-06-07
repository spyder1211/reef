import type { RowEdit, PendingInsert, SqlStatement } from '../../../shared/types'

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/**
 * ステージング中の各 RowEdit を1つの UPDATE 文にする。
 * 値は必ず `?` プレースホルダ、識別子はバッククォート2重化でエスケープ。
 * WHERE は主キー列を AND で結び、値は edit.pk（編集前のオリジナル値）を使う。
 * values が空の行・主キーが空の場合はスキップ/空配列。
 */
export function buildUpdateStatements(
  table: string,
  primaryKey: string[],
  edits: RowEdit[]
): SqlStatement[] {
  if (primaryKey.length === 0) return []
  const statements: SqlStatement[] = []
  for (const edit of edits) {
    const cols = Object.keys(edit.values)
    if (cols.length === 0) continue
    const setClause = cols.map((c) => `${quoteIdent(c)} = ?`).join(', ')
    const whereClause = primaryKey.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const params = [...cols.map((c) => edit.values[c]), ...primaryKey.map((c) => edit.pk[c])]
    statements.push({
      sql: `UPDATE ${quoteIdent(table)} SET ${setClause} WHERE ${whereClause}`,
      params
    })
  }
  return statements
}

/**
 * PendingInsert の各行を1つの INSERT 文にする。
 * 空文字の列は SQL から除外して DB のデフォルト値（AUTO_INCREMENT 等）に委ねる。
 * null は明示的に NULL として渡す。
 * values がすべて空文字 or 空の PendingInsert はスキップ。
 */
export function buildInsertStatements(
  table: string,
  inserts: PendingInsert[]
): SqlStatement[] {
  const statements: SqlStatement[] = []
  for (const insert of inserts) {
    const cols = Object.keys(insert.values).filter((c) => insert.values[c] !== '')
    if (cols.length === 0) continue
    const colList = cols.map(quoteIdent).join(', ')
    const placeholders = cols.map(() => '?').join(', ')
    const params = cols.map((c) => insert.values[c])
    statements.push({
      sql: `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})`,
      params
    })
  }
  return statements
}

/**
 * deletes（行キー → pk値）の各エントリを1つの DELETE 文にする。
 * primaryKey が空なら空配列。
 */
export function buildDeleteStatements(
  table: string,
  primaryKey: string[],
  deletes: Record<string, Record<string, unknown>>
): SqlStatement[] {
  if (primaryKey.length === 0) return []
  return Object.values(deletes).map((pkValues) => {
    const whereClause = primaryKey.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const params = primaryKey.map((c) => pkValues[c])
    return {
      sql: `DELETE FROM ${quoteIdent(table)} WHERE ${whereClause}`,
      params
    }
  })
}
