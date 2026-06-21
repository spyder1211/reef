import type {
  ConnectionConfig,
  ConnectionGroup,
  ConnectionProfile,
  ConnectionProfileInput,
  SshSettings,
  SshSettingsPublic
} from '../../shared/types'
import { t } from '../i18n'

export interface SecretBox {
  isAvailable(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}

export interface StoredProfile extends ConnectionProfile {
  encryptedPassword: string
  sshPasswordEnc?: string // SSH パスワードの暗号文（authMethod=password 時）
  sshPassphraseEnc?: string // 鍵パスフレーズの暗号文（authMethod=privateKey 時）
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
    const prev = idx >= 0 ? profiles[idx] : undefined

    // 暗号化できない時は平文を書かず既存値を保持する（既存暗号文の上書き消失・平文化を防ぐ）。
    const encOrKeep = (plain: string | undefined, existing: string | undefined): string | undefined => {
      if (!plain) return existing
      if (!this.deps.secret.isAvailable()) return existing
      return this.deps.secret.encrypt(plain)
    }

    const encryptedPassword = encOrKeep(input.password, prev?.encryptedPassword) ?? ''
    // groupId は input に明示された場合のみ反映し、無ければ既存値を保持する。
    const groupId = input.groupId !== undefined ? input.groupId : prev?.groupId
    // SSH 設定: 公開部のみ ssh に格納し、秘匿値は暗号化して別フィールドへ。input に ssh が無ければ既存値を保持。
    let ssh: SshSettingsPublic | undefined = prev?.ssh
    let sshPasswordEnc: string | undefined = prev?.sshPasswordEnc
    let sshPassphraseEnc: string | undefined = prev?.sshPassphraseEnc
    if (input.ssh !== undefined) {
      const { password: sshPw, passphrase: sshPp, ...pub } = input.ssh
      ssh = pub
      sshPasswordEnc = encOrKeep(sshPw, prev?.sshPasswordEnc)
      sshPassphraseEnc = encOrKeep(sshPp, prev?.sshPassphraseEnc)
    }
    const stored: StoredProfile = {
      id,
      name: input.name,
      tag: input.tag,
      host: input.host,
      port: input.port,
      user: input.user,
      database: input.database,
      groupId,
      ssh,
      encryptedPassword,
      sshPasswordEnc,
      sshPassphraseEnc
    }
    if (idx >= 0) profiles[idx] = stored
    else profiles.push(stored)
    this.deps.persist(doc)
    return stripSecret(stored)
  }

  // 既存接続を複製する。パスワード（暗号化済み）・タグ・所属グループも引き継ぎ、
  // 新しい id と「… のコピー」名で元の直後に挿入する。renderer はパスワードを参照できないため、
  // 暗号文を扱える main 側で複製する。
  duplicate(id: string): ConnectionProfile {
    const doc = this.deps.load()
    const idx = doc.profiles.findIndex((p) => p.id === id)
    if (idx < 0) throw new Error(`Profile not found: ${id}`)
    const src = doc.profiles[idx]
    const copy: StoredProfile = {
      ...src,
      id: this.deps.genId(),
      name: t('connection.duplicateSuffix', { name: src.name })
    }
    doc.profiles.splice(idx + 1, 0, copy)
    this.deps.persist(doc)
    return stripSecret(copy)
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
    // SSH 公開部に復号した秘匿値を載せて完全な SshSettings を組み立てる。
    const ssh: SshSettings | undefined = p.ssh
      ? {
          ...p.ssh,
          password: p.sshPasswordEnc ? this.deps.secret.decrypt(p.sshPasswordEnc) : undefined,
          passphrase: p.sshPassphraseEnc ? this.deps.secret.decrypt(p.sshPassphraseEnc) : undefined
        }
      : undefined
    return {
      host: p.host,
      port: p.port,
      user: p.user,
      password: this.deps.secret.decrypt(p.encryptedPassword),
      database: p.database,
      ssh
    }
  }
}

function stripSecret(p: StoredProfile): ConnectionProfile {
  const { encryptedPassword: _omit, sshPasswordEnc: _s1, sshPassphraseEnc: _s2, ...rest } = p
  return rest
}
