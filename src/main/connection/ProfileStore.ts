import type { ConnectionConfig, ConnectionProfile, ConnectionProfileInput } from '../../shared/types'

export interface SecretBox {
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export interface ProfileStoreDeps {
  load(): StoredProfile[]
  persist(profiles: StoredProfile[]): void
  secret: SecretBox
  genId(): string
}

export interface StoredProfile extends ConnectionProfile {
  encryptedPassword: string
}

export class ProfileStore {
  constructor(private readonly deps: ProfileStoreDeps) {}

  list(): ConnectionProfile[] {
    return this.deps.load().map(stripSecret)
  }

  save(input: ConnectionProfileInput): ConnectionProfile {
    const profiles = this.deps.load()
    const id = input.id ?? this.deps.genId()
    const idx = profiles.findIndex((p) => p.id === id)
    // 更新時にパスワードが空なら既存の暗号化パスワードを保持する。
    // （編集フォームはパスワードを伏せて空で開くため、未入力＝変更なしと解釈する）
    const encryptedPassword =
      input.password === '' && idx >= 0
        ? profiles[idx].encryptedPassword
        : this.deps.secret.encrypt(input.password)
    const stored: StoredProfile = {
      id,
      name: input.name,
      tag: input.tag,
      host: input.host,
      port: input.port,
      user: input.user,
      database: input.database,
      encryptedPassword
    }
    if (idx >= 0) profiles[idx] = stored
    else profiles.push(stored)
    this.deps.persist(profiles)
    return stripSecret(stored)
  }

  delete(id: string): void {
    this.deps.persist(this.deps.load().filter((p) => p.id !== id))
  }

  getConnectConfig(id: string): ConnectionConfig {
    const p = this.deps.load().find((x) => x.id === id)
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
