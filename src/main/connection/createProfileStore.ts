import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { ProfileStore, type ProfileStoreDeps, type StoredProfile } from './ProfileStore'

export function createProfileStore(): ProfileStore {
  const filePath = join(app.getPath('userData'), 'connections.json')

  const deps: ProfileStoreDeps = {
    load(): StoredProfile[] {
      if (!existsSync(filePath)) return []
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
        return Array.isArray(parsed?.profiles) ? parsed.profiles : []
      } catch {
        return []
      }
    },
    persist(profiles: StoredProfile[]): void {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify({ profiles }, null, 2), 'utf-8')
    },
    secret: {
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

  return new ProfileStore(deps)
}
