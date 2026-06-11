// レコードグリッドの行選択ロジック（純関数）。
// キーボード（上下キー / Shift+上下キー）での選択遷移を、DOM に依存せず計算する。

export interface ArrowSelection {
  indices: number[] // 新しい選択行インデックス（昇順・連続）
  anchor: number // 範囲選択の固定端
  lead: number // アクティブな端（次の移動の起点・スクロール対象）
}

/**
 * 現在の選択集合とアンカーから「アクティブな端（lead）」を導出する。
 * キーボードでの範囲拡張時、アンカーと反対側の端を動かすために使う。
 * - 選択が空: null
 * - アンカー未設定: 最後の選択行
 * - それ以外: アンカーから最も遠い選択行（連続範囲では反対側の端）
 */
export function deriveLead(selectedIndices: number[], anchor: number | null): number | null {
  if (selectedIndices.length === 0) return null
  if (anchor == null) return selectedIndices[selectedIndices.length - 1]
  let lead = selectedIndices[0]
  let best = -1
  for (const i of selectedIndices) {
    const d = Math.abs(i - anchor)
    if (d >= best) {
      best = d
      lead = i
    }
  }
  return lead
}

/**
 * 上下キーによる選択遷移を計算する。
 * - lead が null（未選択）: 下キーは先頭行、上キーは末尾行を単一選択。
 * - shift なし: lead を1つ移動して単一選択（アンカーも移動）。
 * - shift あり: アンカーを固定し lead を1つ移動して [anchor..lead] を範囲選択。
 * 移動は 0..rowCount-1 にクランプ。rowCount<=0 なら null。
 */
export function nextArrowSelection(
  rowCount: number,
  anchor: number | null,
  lead: number | null,
  dir: 1 | -1,
  shift: boolean
): ArrowSelection | null {
  if (rowCount <= 0) return null
  if (lead == null) {
    const start = dir === 1 ? 0 : rowCount - 1
    return { indices: [start], anchor: start, lead: start }
  }
  const newLead = Math.min(rowCount - 1, Math.max(0, lead + dir))
  if (shift) {
    const a = anchor ?? lead
    const lo = Math.min(a, newLead)
    const hi = Math.max(a, newLead)
    const indices: number[] = []
    for (let i = lo; i <= hi; i++) indices.push(i)
    return { indices, anchor: a, lead: newLead }
  }
  return { indices: [newLead], anchor: newLead, lead: newLead }
}
