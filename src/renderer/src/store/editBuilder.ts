import type { RowEdit, SqlStatement } from '../../../shared/types'

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
