import type { ApiResult } from '../../../shared/types'

export function filterProfiles<T extends { name: string; host: string; database?: string }>(
  profiles: T[],
  search: string
): T[] {
  const q = search.trim().toLowerCase()
  if (!q) return profiles
  return profiles.filter((p) => `${p.name} ${p.host} ${p.database ?? ''}`.toLowerCase().includes(q))
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

// 接続プロファイルが本番環境（tag=production）かどうか。
// 本番ガードのダイアログと、ワークスペース上部の警告バーで共有する単一の判定基準。
export function isProductionProfile(profile: { tag: string } | null | undefined): boolean {
  return profile?.tag === 'production'
}

// IPC 結果が本番ガードのキャンセル（CANCELLED）かどうか。
// 失敗だがエラー表示せず静かに中止するために使う。
// 引数は ApiResult<unknown>（成功 {ok:true;data} もそのまま渡せる）。
export function isCancelled(res: ApiResult<unknown>): boolean {
  return !res.ok && res.error.code === 'CANCELLED'
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
