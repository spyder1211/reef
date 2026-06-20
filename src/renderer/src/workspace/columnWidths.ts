// 結果行の固定行高（px）。ResultsGrid.module.css の結果セル height と必ず一致させること。
// 仮想化のスペーサ高さがこの値を基準に計算されるため、ズレるとスクロールが破綻する。
export const ROW_HEIGHT = 25

export const MIN_COL_WIDTH = 48 // 列幅の下限（px）
export const MAX_COL_WIDTH = 480 // 列幅の上限（px）。超過分はセル内 ellipsis 省略

const DEFAULT_SAMPLE_ROWS = 200 // 幅計測に使う先頭サンプル行数
const DEFAULT_PADDING = 24 // td 左右パディング相当の余白（px）

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  return String(value)
}

/**
 * 各列の固定幅を内容から実測して算出する純関数。
 * `measure` は注入（実行時は canvas measureText、テストはフェイク計測器）。
 * ヘッダ＋先頭 sampleRows 行のセル文字幅の最大値に padding を加え、[minWidth, maxWidth] でクランプ。
 */
export function estimateColumnWidths(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  measure: (text: string) => number,
  opts?: { sampleRows?: number; minWidth?: number; maxWidth?: number; padding?: number }
): number[] {
  const sampleRows = opts?.sampleRows ?? DEFAULT_SAMPLE_ROWS
  const minWidth = opts?.minWidth ?? MIN_COL_WIDTH
  const maxWidth = opts?.maxWidth ?? MAX_COL_WIDTH
  const padding = opts?.padding ?? DEFAULT_PADDING
  const sampleCount = Math.min(rows.length, sampleRows)

  return columns.map((col) => {
    let widest = measure(col.name)
    for (let i = 0; i < sampleCount; i++) {
      const w = measure(cellText(rows[i][col.name]))
      if (w > widest) widest = w
    }
    const withPadding = widest + padding
    return Math.round(Math.max(minWidth, Math.min(maxWidth, withPadding)))
  })
}
