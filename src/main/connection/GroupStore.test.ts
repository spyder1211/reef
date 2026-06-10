import { describe, it, expect, beforeEach } from 'vitest'
import { GroupStore } from './GroupStore'
import { ProfileStore, type StoreDeps, type StoredDoc } from './ProfileStore'

function freshDeps(): StoreDeps {
  let doc: StoredDoc = { profiles: [], groups: [] }
  let counter = 0
  return {
    load: () => doc,
    persist: (d) => {
      doc = d
    },
    secret: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    genId: () => `id-${++counter}`
  }
}

describe('GroupStore', () => {
  let deps: StoreDeps
  let g: GroupStore
  beforeEach(() => {
    deps = freshDeps()
    g = new GroupStore(deps)
  })

  it('create で order が末尾に採番され、list は order 昇順', () => {
    const a = g.create('A')
    const b = g.create('B')
    expect(a.order).toBe(0)
    expect(b.order).toBe(1)
    expect(g.list().map((x) => x.name)).toEqual(['A', 'B'])
  })

  it('create は名前を trim する', () => {
    const a = g.create('  Foo  ')
    expect(a.name).toBe('Foo')
  })

  it('rename で名前が変わる。空名は no-op', () => {
    const a = g.create('A')
    g.rename(a.id, 'A2')
    expect(g.list()[0].name).toBe('A2')
    g.rename(a.id, '   ')
    expect(g.list()[0].name).toBe('A2')
  })

  it('存在しない id の rename は no-op', () => {
    const a = g.create('A')
    expect(() => g.rename('nope', 'X')).not.toThrow()
    expect(g.list()[0].name).toBe('A')
  })

  it('reorder で指定順に order を振り直す', () => {
    const a = g.create('A')
    const b = g.create('B')
    const c = g.create('C')
    g.reorder([c.id, a.id, b.id])
    expect(g.list().map((x) => x.name)).toEqual(['C', 'A', 'B'])
  })

  it('reorder に含まれない既存グループは末尾に温存', () => {
    const a = g.create('A')
    const b = g.create('B')
    g.reorder([b.id]) // a を省略
    const names = g.list().map((x) => x.name)
    expect(names).toEqual(['B', 'A'])
  })

  it('delete でグループが消え、所属接続の groupId が外れる（未分類化）', () => {
    const profiles = new ProfileStore(deps)
    const group = g.create('A')
    const p = profiles.save({ name: 'p', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'pw' })
    profiles.move(p.id, group.id)
    expect(profiles.list()[0].groupId).toBe(group.id)

    g.delete(group.id)
    expect(g.list()).toHaveLength(0)
    expect(profiles.list()[0].groupId).toBeUndefined()
  })
})
