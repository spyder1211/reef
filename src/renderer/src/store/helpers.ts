import type { ApiResult } from '../../../shared/types'
// TableTab は useAppStore.ts 内で定義・export されている。型のみ import なので
// コンパイル時に消え、useAppStore→helpers の実行時 import と循環しない。
import type { TableTab } from './useAppStore'

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

// 番号ショートカット(Cmd+1..9)用。n は 1 始まり。1〜8 は tabs[n-1]、9 は常に末尾。
// 対応するタブが無ければ null（呼び出し側で no-op）。
export function tabIdAtPosition(tabs: { id: string }[], n: number): string | null {
  if (n === 9) return tabs[tabs.length - 1]?.id ?? null
  if (n >= 1 && n <= 8) return tabs[n - 1]?.id ?? null
  return null
}

// 相対切替(Cmd+Shift+] / [)用。activeId を基準に dir(+1 次 / -1 前)へ巡回する。
// 空配列は null、activeId 不在(通常は発生しない)は安全側で先頭を返す。
export function adjacentTabId(
  tabs: { id: string }[],
  activeId: string | null,
  dir: 1 | -1
): string | null {
  if (tabs.length === 0) return null
  const idx = tabs.findIndex((t) => t.id === activeId)
  if (idx === -1) return tabs[0].id
  const next = (idx + dir + tabs.length) % tabs.length
  return tabs[next].id
}

// データ再取得でステージング（未コミットの編集・追加・削除）と、それに紐づく編集エラー・
// 行選択が古い行を指さないよう一括初期化した部分オブジェクトを返す。1箇所でも漏らすと
// ステージ残存バグ（消えた行への UPDATE/DELETE）になるため、この6フィールドの単一の出所とする。
export function clearedStaging(): Pick<
  TableTab,
  'edits' | 'inserts' | 'deletes' | 'editError' | 'selectedRowIndices' | 'selectionAnchor'
> {
  return {
    edits: {},
    inserts: [],
    deletes: {},
    editError: null,
    selectedRowIndices: [],
    selectionAnchor: null
  }
}
