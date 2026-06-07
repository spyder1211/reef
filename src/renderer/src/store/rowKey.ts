// 主キー列のオリジナル値から安定した文字列キーを生成（ページ/ソートで行配列が変わっても同じ行を指せる）。
export function rowKeyOf(primaryKey: string[], row: Record<string, unknown>): string {
  return JSON.stringify(primaryKey.map((c) => row[c]))
}

// 行から主キー列の値だけを抜き出す（WHERE 用のオリジナル主キー値）。
export function pkValuesOf(
  primaryKey: string[],
  row: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(primaryKey.map((c) => [c, row[c]]))
}
