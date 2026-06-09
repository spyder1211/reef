// サイドバーのテーブル検索ロジック（純粋関数）。DB に触れずクライアント内で完結する。

// 大文字小文字を無視した部分一致でテーブル名を絞り込む。
// query が空／空白のみなら入力配列をそのまま返す。
export function filterTables(tables: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (q === '') return tables
  return tables.filter((name) => name.toLowerCase().includes(q))
}

// 最初の一致範囲 [start, end) を返す（ハイライト描画用）。
// query が空／空白のみ、または一致しない場合は null。
// indexOf ベースのため正規表現エスケープ不要（特殊文字も literal 扱い）。
export function matchRange(
  name: string,
  query: string
): { start: number; end: number } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return null
  const start = name.toLowerCase().indexOf(q)
  if (start === -1) return null
  return { start, end: start + q.length }
}
