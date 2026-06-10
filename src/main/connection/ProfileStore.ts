import type { ConnectionConfig, ConnectionGroup, ConnectionProfile, ConnectionProfileInput } from '../../shared/types'

export interface SecretBox {
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export interface StoredProfile extends ConnectionProfile {
  encryptedPassword: string
}

// connections.json のドキュメント全体（接続とグループを同居させる）
export interface StoredDoc {
  profiles: StoredProfile[]
  groups: ConnectionGroup[]
}

export interface StoreDeps {
  load(): StoredDoc
  persist(doc: StoredDoc): void
  secret: SecretBox
  genId(): string
}

export class ProfileStore {
  constructor(private readonly deps: StoreDeps) {}

  list(): ConnectionProfile[] {
    return this.deps.load().profiles.map(stripSecret)
  }

  save(input: ConnectionProfileInput): ConnectionProfile {
    const doc = this.deps.load()
    const profiles = doc.profiles
    const id = input.id ?? this.deps.genId()
    const idx = profiles.findIndex((p) => p.id === id)
    // 更新時にパスワードが空なら既存の暗号化パスワードを保持する。
    const encryptedPassword =
      input.password === '' && idx >= 0
        ? profiles[idx].encryptedPassword
        : this.deps.secret.encrypt(input.password)
    // groupId は input に明示された場合のみ反映し、無ければ既存値を保持する。
    // （フォームは groupId を送らないため、DnD/move で設定した所属を消さない）
    const groupId =
      input.groupId !== undefined ? input.groupId : idx >= 0 ? profiles[idx].groupId : undefined
    const stored: StoredProfile = {
      id,
      name: input.name,
      tag: input.tag,
      host: input.host,
      port: input.port,
      user: input.user,
      database: input.database,
      groupId,
      encryptedPassword
    }
    if (idx >= 0) profiles[idx] = stored
    else profiles.push(stored)
    this.deps.persist(doc)
    return stripSecret(stored)
  }

  delete(id: string): void {
    const doc = this.deps.load()
    doc.profiles = doc.profiles.filter((p) => p.id !== id)
    this.deps.persist(doc)
  }

  move(profileId: string, groupId: string | null): void {
    const doc = this.deps.load()
    const idx = doc.profiles.findIndex((x) => x.id === profileId)
    if (idx < 0) return
    doc.profiles[idx] = { ...doc.profiles[idx], groupId: groupId ?? undefined }
    this.deps.persist(doc)
  }

  getConnectConfig(id: string): ConnectionConfig {
    const p = this.deps.load().profiles.find((x) => x.id === id)
    if (!p) throw new Error(`Profile not found: ${id}`)
    return {
      host: p.host,
      port: p.port,
      user: p.user,
      password: this.deps.secret.decrypt(p.encryptedPassword),
      database: p.database
    }
  }
}

function stripSecret(p: StoredProfile): ConnectionProfile {
  const { encryptedPassword: _omit, ...rest } = p
  return rest
}
