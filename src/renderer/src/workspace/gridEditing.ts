import type { QueryColumn } from '../../../shared/types'

// Enter で行編集を開始する際の対象列。先頭列を編集可能列とする
// （アクティブセル概念は導入しない＝最小実装）。
export function firstEditableColumn(columns: QueryColumn[]): string | null {
  return columns[0]?.name ?? null
}
