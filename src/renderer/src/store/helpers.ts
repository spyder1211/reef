export function filterProfiles<T extends { name: string; host: string; database?: string }>(
  profiles: T[],
  search: string
): T[] {
  const q = search.trim().toLowerCase()
  if (!q) return profiles
  return profiles.filter((p) =>
    `${p.name} ${p.host} ${p.database ?? ''}`.toLowerCase().includes(q)
  )
}

export function pickNextActiveTabId(
  tabs: { id: string }[],
  closingId: string,
  activeId: string | null
): string | null {
  if (activeId !== closingId) return activeId
  const idx = tabs.findIndex((t) => t.id === closingId)
  const remaining = tabs.filter((t) => t.id !== closingId)
  if (remaining.length === 0) return null
  return (remaining[idx] ?? remaining[remaining.length - 1]).id
}

// 未コミットのステージング変更（UPDATE/INSERT/DELETE）があるか。
// SqlTab には該当概念がないため常に false。
// useAppStore の Tab 型を import すると循環依存になるため構造的型で受ける。
export function hasUncommittedChanges(tab: {
  kind: string
  edits?: Record<string, unknown>
  inserts?: unknown[]
  deletes?: Record<string, unknown>
}): boolean {
  if (tab.kind !== 'table') return false
  return (
    Object.keys(tab.edits ?? {}).length > 0 ||
    (tab.inserts ?? []).length > 0 ||
    Object.keys(tab.deletes ?? {}).length > 0
  )
}
