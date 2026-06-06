export function buildSelectQuery(table: string): string {
  return `SELECT * FROM \`${table}\` LIMIT 100;`
}

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
