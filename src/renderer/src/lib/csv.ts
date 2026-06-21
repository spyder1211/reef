// CSV 直列化（純粋関数）。BOM は付けない（ファイル保存時にメイン側で付与する）。
// 値は null/undefined を空文字、それ以外は String(value)（グリッド表示と一致）にし、
// RFC 4180 のクォート規則でエスケープする。行区切りは CRLF。

// 値を 1 セル分の CSV フィールドに変換する。
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // ダブルクォート・カンマ・CR・LF のいずれかを含む場合はクォートし、内部の " を "" に2重化する。
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * 列名（ヘッダ）と行データから CSV 文字列を生成する。
 * @param columns ヘッダに使う列名（出力する列順を兼ねる）。
 * @param rows 各行の「列名 → 値」マップ。
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0) return ''
  const header = columns.map(escapeCell).join(',')
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c])).join(','))
  return [header, ...body].join('\r\n')
}

// 1 セル分の TSV フィールドに変換する。タブ/CR/LF/ダブルクォートを含む場合のみ
// CSV と同じクォート規則（" で囲み内部の " を "" に2重化）を適用する。
function escapeTsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/["\t\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * 列順に従い行データを TSV 文字列に直列化する（ヘッダなし）。
 * 行区切りは CRLF。列が空・行が空のときは空文字を返す。
 * @param columns 出力する列順（ヘッダ行は出力しない）。
 * @param rows 各行の「列名 → 値」マップ。
 */
export function toTsv(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return ''
  return rows.map((row) => columns.map((c) => escapeTsvCell(row[c])).join('\t')).join('\r\n')
}
