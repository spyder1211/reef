import { describe, expect, it } from 'vitest'
import type { ConnectionGroup, ConnectionProfile } from '../../../shared/types'
import { buildGroupedView, computeReorder, UNGROUPED_ID } from './grouping'

function prof(p: Partial<ConnectionProfile> & { id: string }): ConnectionProfile {
  return { name: p.id, tag: 'local', host: 'h', port: 3306, user: 'u', ...p }
}

const groups: ConnectionGroup[] = [
  { id: 'g1', name: 'Beta', order: 1 },
  { id: 'g2', name: 'Alpha', order: 0 }
]

describe('buildGroupedView', () => {
  it('グループは order 昇順、未分類は末尾に置く', () => {
    const profiles = [
      prof({ id: 'a', groupId: 'g1' }),
      prof({ id: 'b', groupId: 'g2' }),
      prof({ id: 'c' }) // 未分類
    ]
    const views = buildGroupedView(profiles, groups, '')
    expect(views.map((v) => v.id)).toEqual(['g2', 'g1', UNGROUPED_ID])
    expect(views[2].name).toBe('未分類')
  })

  it('未分類の接続が無ければ未分類グループは出さない', () => {
    const profiles = [prof({ id: 'a', groupId: 'g1' })]
    const views = buildGroupedView(profiles, groups, '')
    expect(views.some((v) => v.id === UNGROUPED_ID)).toBe(false)
  })

  it('環境サブグループは TAG_ORDER 順で、接続0件の tag は出さない', () => {
    const profiles = [
      prof({ id: 'a', groupId: 'g1', tag: 'local' }),
      prof({ id: 'b', groupId: 'g1', tag: 'production' })
    ]
    const views = buildGroupedView(profiles, groups, '')
    // biome-ignore lint/style/noNonNullAssertion: find result is known to exist given test setup
    const g1 = views.find((v) => v.id === 'g1')!
    expect(g1.subgroups.map((s) => s.tag)).toEqual(['production', 'local'])
    expect(g1.count).toBe(2)
  })

  it('未知の groupId を指す接続は未分類へ', () => {
    const profiles = [prof({ id: 'a', groupId: 'ghost' })]
    const views = buildGroupedView(profiles, groups, '')
    // biome-ignore lint/style/noNonNullAssertion: find result is known to exist given test setup
    const ung = views.find((v) => v.id === UNGROUPED_ID)!
    expect(ung.count).toBe(1)
  })

  it('検索なしのときは空の作成済みグループも見出しを残す', () => {
    const profiles = [prof({ id: 'a', groupId: 'g1' })]
    const views = buildGroupedView(profiles, groups, '')
    expect(views.some((v) => v.id === 'g2')).toBe(true) // 空でも残る
  })

  it('検索時は一致接続でフィルタし、空グループを隠す', () => {
    const profiles = [
      prof({ id: 'alpha', name: 'alpha', groupId: 'g1' }),
      prof({ id: 'beta', name: 'beta', groupId: 'g2' })
    ]
    const views = buildGroupedView(profiles, groups, 'alpha')
    expect(views.map((v) => v.id)).toEqual(['g1'])
    expect(views[0].count).toBe(1)
  })
})

describe('computeReorder', () => {
  it('ドラッグした要素をターゲットの直前へ挿入', () => {
    expect(computeReorder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(computeReorder(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c'])
  })
  it('自分自身へのドロップは no-op', () => {
    expect(computeReorder(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c'])
  })
  it('未知のターゲットは元の順を返す', () => {
    expect(computeReorder(['a', 'b'], 'a', 'z')).toEqual(['a', 'b'])
  })
})
