export interface OrderedColumn {
  name: string
  pinned: boolean
}

// 可視（hidden 除外）かつ並び替え（ピン列を pinned 順で先頭、残りを元順）した列リスト。
// 現在の列名に無い hidden/pinned エントリは無視される（列が変わるクエリ後の残留は無害）。
export function orderColumns(
  allNames: string[],
  hidden: string[],
  pinned: string[]
): OrderedColumn[] {
  const hiddenSet = new Set(hidden)
  const visible = allNames.filter((n) => !hiddenSet.has(n))
  const visibleSet = new Set(visible)
  const pinnedVisible = pinned.filter((n) => visibleSet.has(n))
  const pinnedSet = new Set(pinnedVisible)
  const rest = visible.filter((n) => !pinnedSet.has(n))
  return [
    ...pinnedVisible.map((name) => ({ name, pinned: true })),
    ...rest.map((name) => ({ name, pinned: false }))
  ]
}

// orderedCols（ピンが先頭に連続）と整列済み実効幅から、各ピン列の left(px) を返す。
// 非ピン列は null。先頭ピン=0、以降は先行ピン幅の累積。
export function pinnedLeftOffsets(ordered: OrderedColumn[], widths: number[]): (number | null)[] {
  let acc = 0
  return ordered.map((c, i) => {
    if (!c.pinned) return null
    const left = acc
    acc += widths[i] ?? 0
    return left
  })
}
