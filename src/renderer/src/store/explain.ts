// EXPLAIN 用：入力 SQL を単一文として取り出す。
// 末尾セミコロン・前後空白は許容。文中に ; が残る（=複数文）場合は null。
// 注: 文字列リテラル内の ; は誤判定するが、EXPLAIN 用途では許容する簡易実装。
export function singleStatementOf(sql: string): string | null {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (trimmed.length === 0) return null
  if (trimmed.includes(';')) return null
  return trimmed
}
