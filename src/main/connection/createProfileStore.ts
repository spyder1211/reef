import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync, mkdirSync, chmodSync } from 'fs'
import { writeFileSecure } from '../util/writeFileSecure'
import { join, dirname } from 'path'
import { ProfileStore, type StoreDeps, type StoredDoc, type StoredProfile } from './ProfileStore'
import { GroupStore } from './GroupStore'
import type { ConnectionGroup } from '../../shared/types'

export function createConnectionStores(): { profileStore: ProfileStore; groupStore: GroupStore } {
  const filePath = join(app.getPath('userData'), 'connections.json')

  const deps: StoreDeps = {
    load(): StoredDoc {
      if (!existsSync(filePath)) return { profiles: [], groups: [] }
      // 旧バージョンで 0o644 等の緩いパーミッションで作られた既存ファイルを起動時に締め直す。
      // （writeFileSecure は次回の保存時にしか走らないため、保存しないユーザーも保護する）
      try {
        chmodSync(filePath, 0o600)
      } catch {
        // Windows 等 chmod 非対応環境では no-op（読み込みは続行する）
      }
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
        const profiles: StoredProfile[] = Array.isArray(parsed?.profiles) ? parsed.profiles : []
        const groups: ConnectionGroup[] = Array.isArray(parsed?.groups) ? parsed.groups : []
        return { profiles, groups }
      } catch {
        return { profiles: [], groups: [] }
      }
    },
    persist(doc: StoredDoc): void {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSecure(
        filePath,
        JSON.stringify({ profiles: doc.profiles, groups: doc.groups }, null, 2)
      )
    },
    secret: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt(plain: string): string {
        if (!safeStorage.isEncryptionAvailable()) return ''
        return safeStorage.encryptString(plain).toString('base64')
      },
      decrypt(cipher: string): string {
        if (!cipher) return ''
        return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
      }
    },
    genId: () => randomUUID()
  }

  // 両ストアが同一 deps を共有 → 同じファイルを read-modify-write し、互いのスライスを壊さない
  return { profileStore: new ProfileStore(deps), groupStore: new GroupStore(deps) }
}
