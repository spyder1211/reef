import { describe, it, expect, beforeEach } from 'vitest'
import { ProfileStore, type ProfileStoreDeps, type StoredProfile } from './ProfileStore'

function freshDeps(): ProfileStoreDeps {
  let store: StoredProfile[] = []
  let counter = 0
  return {
    load: () => store,
    persist: (p) => {
      store = p
    },
    secret: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
    genId: () => `id-${++counter}`
  }
}

describe('ProfileStore', () => {
  let s: ProfileStore
  beforeEach(() => { s = new ProfileStore(freshDeps()) })

  it('保存すると id が採番され、一覧に出る（パスワードは含まない）', () => {
    const saved = s.save({ name: 'local-db', tag: 'local', host: '127.0.0.1', port: 3306, user: 'root', password: 'pw', database: 'app' })
    expect(saved.id).toBe('id-1')
    expect((saved as any).password).toBeUndefined()
    const list = s.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'local-db', tag: 'local', host: '127.0.0.1' })
    expect((list[0] as any).encryptedPassword).toBeUndefined()
  })

  it('同じ id で保存すると更新（増えない）', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    s.save({ id: a.id, name: 'a2', tag: 'staging', host: 'h2', port: 3307, user: 'u', password: 'p' })
    const list = s.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('a2')
    expect(list[0].tag).toBe('staging')
  })

  it('delete で消える', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    s.delete(a.id)
    expect(s.list()).toHaveLength(0)
  })

  it('getConnectConfig で復号したパスワード付き設定を返す', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'secret', database: 'db' })
    expect(s.getConnectConfig(a.id)).toEqual({ host: 'h', port: 3306, user: 'u', password: 'secret', database: 'db' })
  })

  it('存在しない id の getConnectConfig は例外', () => {
    expect(() => s.getConnectConfig('nope')).toThrow()
  })
})
