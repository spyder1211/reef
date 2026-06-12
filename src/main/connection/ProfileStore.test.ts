import { describe, it, expect, beforeEach } from 'vitest'
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

describe('ProfileStore', () => {
  let s: ProfileStore
  beforeEach(() => {
    s = new ProfileStore(freshDeps())
  })

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

  it('更新時に password が空なら既存の暗号化パスワードを保持する', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'secret' })
    s.save({ id: a.id, name: 'a2', tag: 'staging', host: 'h', port: 3306, user: 'u', password: '' })
    expect(s.getConnectConfig(a.id).password).toBe('secret')
  })

  it('更新時に password を入力すれば差し替わる', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'old' })
    s.save({ id: a.id, name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'new' })
    expect(s.getConnectConfig(a.id).password).toBe('new')
  })

  it('duplicate は新 id・「… のコピー」名で複製し、パスワード/タグ/グループを引き継ぐ', () => {
    const a = s.save({ name: 'orig', tag: 'staging', host: 'h', port: 3306, user: 'u', password: 'secret', database: 'db' })
    s.move(a.id, 'g1')
    const copy = s.duplicate(a.id)
    expect(copy.id).not.toBe(a.id)
    expect(copy.name).toBe('orig のコピー')
    expect(copy.tag).toBe('staging')
    expect(copy.groupId).toBe('g1')
    // 暗号化パスワードも引き継ぐ（renderer から再入力不要）
    expect(s.getConnectConfig(copy.id).password).toBe('secret')
  })

  it('duplicate は元の直後に挿入し、件数が増える', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    s.save({ name: 'b', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    s.duplicate(a.id)
    expect(s.list().map((p) => p.name)).toEqual(['a', 'a のコピー', 'b'])
  })

  it('存在しない id の duplicate は例外', () => {
    expect(() => s.duplicate('nope')).toThrow()
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

  it('move で groupId を設定し、null で未分類に戻す', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    s.move(a.id, 'g1')
    expect(s.list()[0].groupId).toBe('g1')
    s.move(a.id, null)
    expect(s.list()[0].groupId).toBeUndefined()
  })

  it('存在しない id の move は no-op', () => {
    s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    expect(() => s.move('nope', 'g1')).not.toThrow()
  })

  it('save は input に groupId が無ければ既存の groupId を保持する', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    s.move(a.id, 'g1')
    s.save({ id: a.id, name: 'a2', tag: 'local', host: 'h', port: 3306, user: 'u', password: '' })
    expect(s.list()[0].groupId).toBe('g1')
  })

  it('save で groupId を明示すれば差し替わる', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p', groupId: 'g1' })
    expect(s.list()[0].groupId).toBe('g1')
    s.save({ id: a.id, name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: '', groupId: 'g2' })
    expect(s.list()[0].groupId).toBe('g2')
  })

  it('save / move / delete は既存の groups を保持する', () => {
    let doc: StoredDoc = { profiles: [], groups: [{ id: 'g1', name: 'G', order: 0 }] }
    const deps: StoreDeps = {
      load: () => doc,
      persist: (d) => { doc = d },
      secret: { encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
      genId: () => 'pid-1'
    }
    const store = new ProfileStore(deps)
    const a = store.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p' })
    store.move(a.id, 'g1')
    store.delete(a.id)
    expect(doc.groups).toEqual([{ id: 'g1', name: 'G', order: 0 }])
  })

  it('SSH 設定を保存し、list では password/passphrase を返さない', () => {
    const saved = s.save({
      name: 'with-ssh', tag: 'staging', host: 'db', port: 3306, user: 'u', password: 'p',
      ssh: { enabled: true, host: 'bastion', port: 22, user: 'ec2-user', authMethod: 'password', password: 'sshpw' }
    })
    const listed = s.list().find((p) => p.id === saved.id)
    expect(listed?.ssh).toMatchObject({ enabled: true, host: 'bastion', user: 'ec2-user', authMethod: 'password' })
    expect((listed?.ssh as Record<string, unknown>).password).toBeUndefined()
    expect((listed?.ssh as Record<string, unknown>).passphrase).toBeUndefined()
  })

  it('getConnectConfig は SSH パスワード/パスフレーズを復号して返す', () => {
    const saved = s.save({
      name: 'with-ssh', tag: 'staging', host: 'db', port: 3306, user: 'u', password: 'p',
      ssh: { enabled: true, host: 'bastion', port: 22, user: 'ec2-user', authMethod: 'privateKey', privateKeyPath: '/k', passphrase: 'pp' }
    })
    const cfg = s.getConnectConfig(saved.id)
    expect(cfg.ssh).toMatchObject({ enabled: true, host: 'bastion', authMethod: 'privateKey', privateKeyPath: '/k', passphrase: 'pp' })
  })

  it('更新時に SSH パスワードが空なら既存の暗号文を保持する', () => {
    const a = s.save({
      name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p',
      ssh: { enabled: true, host: 'b', port: 22, user: 'u', authMethod: 'password', password: 'sshpw' }
    })
    s.save({
      id: a.id, name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: '',
      ssh: { enabled: true, host: 'b', port: 22, user: 'u', authMethod: 'password', password: '' }
    })
    expect(s.getConnectConfig(a.id).ssh?.password).toBe('sshpw')
  })

  it('duplicate は SSH 設定（暗号文含む）を引き継ぐ', () => {
    const a = s.save({
      name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p',
      ssh: { enabled: true, host: 'b', port: 22, user: 'u', authMethod: 'password', password: 'sshpw' }
    })
    const copy = s.duplicate(a.id)
    expect(s.getConnectConfig(copy.id).ssh?.password).toBe('sshpw')
  })
})
