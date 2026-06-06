export function extractTableNames(rows: Record<string, unknown>[]): string[] {
  return rows
    .map((r) => String(Object.values(r)[0] ?? ''))
    .filter((name) => name.length > 0)
}
