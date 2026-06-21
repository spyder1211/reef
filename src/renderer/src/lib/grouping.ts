import type { ConnectionGroup, ConnectionProfile, ConnectionTag } from '../../../shared/types'
import { TAG_ORDER } from './tags'
import { filterProfiles } from '../store/helpers'

export const UNGROUPED_ID = '__ungrouped__'
// 未分類グループ（バケット）の内部 view.name。表示は GroupSection が isUngrouped を見て
// t('connectionGroup.ungrouped') に差し替えるため、この値は UI には出ない内部 sentinel。
export const UNGROUPED_NAME = '未分類'

export interface EnvSubgroup {
  tag: ConnectionTag
  profiles: ConnectionProfile[]
}

export interface GroupView {
  id: string
  name: string
  isUngrouped: boolean
  subgroups: EnvSubgroup[]
  count: number
}

export function buildGroupedView(
  profiles: ConnectionProfile[],
  groups: ConnectionGroup[],
  search: string
): GroupView[] {
  const shown = filterProfiles(profiles, search)
  const searching = search.trim().length > 0

  const validIds = new Set(groups.map((g) => g.id))
  const byGroup = new Map<string, ConnectionProfile[]>()
  for (const p of shown) {
    const key = p.groupId && validIds.has(p.groupId) ? p.groupId : UNGROUPED_ID
    const arr = byGroup.get(key) ?? []
    arr.push(p)
    byGroup.set(key, arr)
  }

  const views: GroupView[] = []
  for (const g of [...groups].sort((a, b) => a.order - b.order)) {
    const members = byGroup.get(g.id) ?? []
    if (searching && members.length === 0) continue // 検索中は空グループを隠す
    views.push(toView(g.id, g.name, false, members))
  }

  const ungrouped = byGroup.get(UNGROUPED_ID) ?? []
  if (ungrouped.length > 0) {
    views.push(toView(UNGROUPED_ID, UNGROUPED_NAME, true, ungrouped))
  }
  return views
}

function toView(
  id: string,
  name: string,
  isUngrouped: boolean,
  members: ConnectionProfile[]
): GroupView {
  const subgroups: EnvSubgroup[] = []
  for (const tag of TAG_ORDER) {
    const ps = members.filter((p) => p.tag === tag)
    if (ps.length > 0) subgroups.push({ tag, profiles: ps })
  }
  return { id, name, isUngrouped, subgroups, count: members.length }
}

// ドラッグした要素をターゲットの直前へ挿入した新しい id 配列を返す（純関数）
export function computeReorder(orderedIds: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return orderedIds
  const without = orderedIds.filter((id) => id !== draggedId)
  const targetIdx = without.indexOf(targetId)
  if (targetIdx === -1) return orderedIds
  without.splice(targetIdx, 0, draggedId)
  return without
}
