# コネクション一覧の2階層グループ化 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コネクション一覧を「ユーザー作成の上位グループ → 接続タグから導出する環境サブグループ → 接続」の2階層で表示し、接続のグループ間移動とグループ並び替えをドラッグ&ドロップで行えるようにする。

**Architecture:** main 側は `connections.json` を `{profiles, groups}` ドキュメントに拡張し、`ProfileStore`（接続）と新設 `GroupStore`（グループ）が共有 deps を read-modify-write する。renderer 側は純関数 `lib/grouping.ts` でビューモデルを組み立て、`GroupSection` が見出し・折り畳み・リネーム・削除・ネイティブ HTML5 DnD を担う。

**Tech Stack:** Electron + electron-vite / React + zustand / TypeScript / vitest（追加依存なし）。

参照仕様: `docs/superpowers/specs/2026-06-10-connection-groups-design.md`

共通コマンド:
- 型チェック: `npm run typecheck`
- テスト: `npm test`（= `vitest run`）

---

## Task 1: 共有型に `ConnectionGroup` と `groupId` を追加

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 型を追加する**

`src/shared/types.ts` の `ConnectionTag` 定義（33行目付近）の直後に `ConnectionGroup` を追加する:

```ts
// 接続グループ（上位グループ）。環境サブグループは tag から導出するため保存しない
export interface ConnectionGroup {
  id: string
  name: string
  order: number // 並び替え用。小さいほど上に表示
}
```

`ConnectionProfile` インターフェースに `groupId` を追加する（`database?: string` の次の行）:

```ts
  database?: string
  groupId?: string // 所属グループ。未設定 = 未分類
```

`ConnectionProfileInput` インターフェースにも同様に追加する（`database?: string` の次の行）:

```ts
  database?: string
  groupId?: string // 通常フォームからは送らない。DnD/move 経由で設定
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS（型追加のみ。既存コードに影響なし）

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: ConnectionGroup 型と接続の groupId を共有型に追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 永続化 deps をドキュメント単位化し、`ProfileStore` に `move()` を追加

`ProfileStoreDeps` を `StoreDeps`（`load(): StoredDoc`）へ一般化し、`save()` の `groupId` 保持と新メソッド `move()` を TDD で実装する。

**Files:**
- Modify: `src/main/connection/ProfileStore.ts`
- Test: `src/main/connection/ProfileStore.test.ts`

- [ ] **Step 1: テストを更新（失敗させる）**

`src/main/connection/ProfileStore.test.ts` を全置換する:

```ts
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
    // フォーム保存相当（groupId を含めない）
    s.save({ id: a.id, name: 'a2', tag: 'local', host: 'h', port: 3306, user: 'u', password: '' })
    expect(s.list()[0].groupId).toBe('g1')
  })

  it('save で groupId を明示すれば差し替わる', () => {
    const a = s.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'p', groupId: 'g1' })
    expect(s.list()[0].groupId).toBe('g1')
    s.save({ id: a.id, name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: '', groupId: 'g2' })
    expect(s.list()[0].groupId).toBe('g2')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/main/connection/ProfileStore.test.ts`
Expected: FAIL（`StoreDeps` / `StoredDoc` が未 export、`move` 未定義でコンパイルエラー）

- [ ] **Step 3: `ProfileStore.ts` を実装**

`src/main/connection/ProfileStore.ts` を全置換する:

```ts
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
    const p = doc.profiles.find((x) => x.id === profileId)
    if (!p) return
    p.groupId = groupId ?? undefined
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/main/connection/ProfileStore.test.ts`
Expected: PASS（全 11 ケース）

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/ProfileStore.ts src/main/connection/ProfileStore.test.ts
git commit -m "refactor: ProfileStore を StoredDoc 単位の deps に一般化し move() を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `GroupStore` を新設

`StoreDeps` を共有し `StoredDoc.groups` を CRUD する純ロジックを TDD で実装する。

**Files:**
- Create: `src/main/connection/GroupStore.ts`
- Test: `src/main/connection/GroupStore.test.ts`

- [ ] **Step 1: テストを書く（失敗させる）**

`src/main/connection/GroupStore.test.ts` を作成する:

```ts
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
    expect(names[0]).toBe('B')
    expect(names).toContain('A')
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/main/connection/GroupStore.test.ts`
Expected: FAIL（`./GroupStore` が存在しない）

- [ ] **Step 3: `GroupStore.ts` を実装**

`src/main/connection/GroupStore.ts` を作成する:

```ts
import type { ConnectionGroup } from '../../shared/types'
import type { StoreDeps } from './ProfileStore'

export class GroupStore {
  constructor(private readonly deps: StoreDeps) {}

  list(): ConnectionGroup[] {
    return [...this.deps.load().groups].sort((a, b) => a.order - b.order)
  }

  create(name: string): ConnectionGroup {
    const doc = this.deps.load()
    const maxOrder = doc.groups.reduce((m, x) => Math.max(m, x.order), -1)
    const group: ConnectionGroup = { id: this.deps.genId(), name: name.trim(), order: maxOrder + 1 }
    doc.groups.push(group)
    this.deps.persist(doc)
    return group
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const doc = this.deps.load()
    const grp = doc.groups.find((x) => x.id === id)
    if (!grp) return
    grp.name = trimmed
    this.deps.persist(doc)
  }

  delete(id: string): void {
    const doc = this.deps.load()
    doc.groups = doc.groups.filter((x) => x.id !== id)
    for (const p of doc.profiles) {
      if (p.groupId === id) p.groupId = undefined
    }
    this.deps.persist(doc)
  }

  reorder(orderedIds: string[]): void {
    const doc = this.deps.load()
    const byId = new Map(doc.groups.map((x) => [x.id, x]))
    let order = 0
    for (const id of orderedIds) {
      const grp = byId.get(id)
      if (grp) {
        grp.order = order++
        byId.delete(id)
      }
    }
    // orderedIds に無い既存グループは末尾に温存する
    for (const grp of byId.values()) grp.order = order++
    this.deps.persist(doc)
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/main/connection/GroupStore.test.ts`
Expected: PASS（全 6 ケース）

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/GroupStore.ts src/main/connection/GroupStore.test.ts
git commit -m "feat: グループCRUDの GroupStore を追加（共有 deps で接続と原子的に同居）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `createConnectionStores()` ファクトリ化

`createProfileStore.ts` を、共有 deps から `ProfileStore` と `GroupStore` を生成するファクトリへ書き換える。

**Files:**
- Modify: `src/main/connection/createProfileStore.ts`

- [ ] **Step 1: ファクトリを実装**

`src/main/connection/createProfileStore.ts` を全置換する:

```ts
import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { ProfileStore, type StoreDeps, type StoredDoc, type StoredProfile } from './ProfileStore'
import { GroupStore } from './GroupStore'
import type { ConnectionGroup } from '../../shared/types'

export function createConnectionStores(): { profileStore: ProfileStore; groupStore: GroupStore } {
  const filePath = join(app.getPath('userData'), 'connections.json')

  const deps: StoreDeps = {
    load(): StoredDoc {
      if (!existsSync(filePath)) return { profiles: [], groups: [] }
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
      writeFileSync(
        filePath,
        JSON.stringify({ profiles: doc.profiles, groups: doc.groups }, null, 2),
        'utf-8'
      )
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

  // 両ストアが同一 deps を共有 → 同じファイルを read-modify-write し、互いのスライスを壊さない
  return { profileStore: new ProfileStore(deps), groupStore: new GroupStore(deps) }
}
```

- [ ] **Step 2: 型チェック（呼び出し側未修正なのでエラーが出ることを確認）**

Run: `npm run typecheck`
Expected: FAIL（`src/main/index.ts` がまだ `createProfileStore` を import している）→ 次の Task 5 で修正する。

> このタスクは単独ではビルドが通らないため、Task 5 と続けて実施し、Task 5 末尾でまとめてコミットする。ここではコミットしない。

---

## Task 5: IPC ハンドラ・main 配線・preload・型定義の更新

新ストアを配線し、`groups:*` と `connections:move` の IPC・preload ブリッジ・`Window.api` 型を追加する。

**Files:**
- Modify: `src/main/ipc/registerConnectionHandlers.ts`
- Modify: `src/main/index.ts`（8行目 import、53行目 呼び出し）
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: IPC ハンドラを更新**

`src/main/ipc/registerConnectionHandlers.ts` を全置換する:

```ts
import { ipcMain } from 'electron'
import { ConnectionManager } from '../connection/ConnectionManager'
import { ProfileStore } from '../connection/ProfileStore'
import { GroupStore } from '../connection/GroupStore'
import { validateConnectionConfig } from '../connection/validateConnectionConfig'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ApiResult, ConnectionGroup, ConnectionProfile, ConnectionProfileInput } from '../../shared/types'

export function registerConnectionHandlers(
  manager: ConnectionManager,
  store: ProfileStore,
  groups: GroupStore
): void {
  ipcMain.handle('connections:list', async (): Promise<ApiResult<ConnectionProfile[]>> => {
    try {
      return { ok: true, data: store.list() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle(
    'connections:save',
    async (_e, input: ConnectionProfileInput): Promise<ApiResult<ConnectionProfile>> => {
      if (!input.name) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: 'name は必須です' } }
      }
      const errors = validateConnectionConfig(input)
      if (errors.length > 0) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: errors.join(', ') } }
      }
      try {
        return { ok: true, data: store.save(input) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('connections:delete', async (_e, id: string): Promise<ApiResult<null>> => {
    try {
      store.delete(id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('connections:connect', async (_e, id: string): Promise<ApiResult<null>> => {
    try {
      const config = store.getConnectConfig(id)
      await manager.connect(config)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle(
    'connections:move',
    async (_e, profileId: string, groupId: string | null): Promise<ApiResult<null>> => {
      try {
        store.move(profileId, groupId)
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('groups:list', async (): Promise<ApiResult<ConnectionGroup[]>> => {
    try {
      return { ok: true, data: groups.list() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:create', async (_e, name: string): Promise<ApiResult<ConnectionGroup>> => {
    if (!name || !name.trim()) {
      return { ok: false, error: { code: 'INVALID_CONFIG', message: 'グループ名は必須です' } }
    }
    try {
      return { ok: true, data: groups.create(name) }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:rename', async (_e, id: string, name: string): Promise<ApiResult<null>> => {
    try {
      groups.rename(id, name)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:delete', async (_e, id: string): Promise<ApiResult<null>> => {
    try {
      groups.delete(id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:reorder', async (_e, orderedIds: string[]): Promise<ApiResult<null>> => {
    try {
      groups.reorder(orderedIds)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
}
```

- [ ] **Step 2: main の配線を更新**

`src/main/index.ts` の 8 行目 import を置換する:

```ts
import { createConnectionStores } from './connection/createProfileStore'
```

53 行目の呼び出しを置換する:

```ts
  const { profileStore, groupStore } = createConnectionStores()
  registerConnectionHandlers(manager, profileStore, groupStore)
```

- [ ] **Step 3: preload ブリッジを追加**

`src/preload/index.ts` の型 import に `ConnectionGroup` を追加する（`ConnectionProfileInput,` の次の行）:

```ts
  ConnectionProfileInput,
  ConnectionGroup,
```

`api` オブジェクト内の `connections` ブロックを、末尾に `move` を加えた形に置換する:

```ts
  connections: {
    list: (): Promise<ApiResult<ConnectionProfile[]>> => ipcRenderer.invoke('connections:list'),
    save: (input: ConnectionProfileInput): Promise<ApiResult<ConnectionProfile>> =>
      ipcRenderer.invoke('connections:save', input),
    delete: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:delete', id),
    connect: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:connect', id),
    move: (profileId: string, groupId: string | null): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('connections:move', profileId, groupId)
  },
  groups: {
    list: (): Promise<ApiResult<ConnectionGroup[]>> => ipcRenderer.invoke('groups:list'),
    create: (name: string): Promise<ApiResult<ConnectionGroup>> =>
      ipcRenderer.invoke('groups:create', name),
    rename: (id: string, name: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('groups:rename', id, name),
    delete: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('groups:delete', id),
    reorder: (orderedIds: string[]): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('groups:reorder', orderedIds)
  }
}
```

> 注意: 直前の `connections` ブロックは元々 `connect` の行で `}` 閉じていた。`connect` 行末にカンマを付け `move` を追加し、`connections` ブロックの `}` の後にカンマを付けて `groups` ブロックを続ける。`api` 全体を閉じる `}` はそのまま。

- [ ] **Step 4: renderer の `Window.api` 型を更新**

`src/renderer/src/env.d.ts` の型 import に `ConnectionGroup` を追加する（`ConnectionProfileInput,` の次の行）:

```ts
  ConnectionProfileInput,
  ConnectionGroup,
```

`connections` ブロックを置換し、`groups` ブロックを追加する（`connections` の `}` の後に続ける。`api` を閉じる `}` の前）:

```ts
      connections: {
        list: () => Promise<ApiResult<ConnectionProfile[]>>
        save: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
        delete: (id: string) => Promise<ApiResult<null>>
        connect: (id: string) => Promise<ApiResult<null>>
        move: (profileId: string, groupId: string | null) => Promise<ApiResult<null>>
      }
      groups: {
        list: () => Promise<ApiResult<ConnectionGroup[]>>
        create: (name: string) => Promise<ApiResult<ConnectionGroup>>
        rename: (id: string, name: string) => Promise<ApiResult<null>>
        delete: (id: string) => Promise<ApiResult<null>>
        reorder: (orderedIds: string[]) => Promise<ApiResult<null>>
      }
```

- [ ] **Step 5: 型チェック・テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（main/preload/renderer すべてコンパイル成功、既存テスト緑）

- [ ] **Step 6: Commit**

```bash
git add src/main/connection/createProfileStore.ts src/main/ipc/registerConnectionHandlers.ts src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: groups/connections:move の IPC・preload・型を追加し両ストアを配線

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: グルーピング純関数 `lib/grouping.ts`

ビューモデル構築 `buildGroupedView` と並び替え計算 `computeReorder` を TDD で実装する（この機能の中核ロジック）。

**Files:**
- Create: `src/renderer/src/lib/grouping.ts`
- Test: `src/renderer/src/lib/grouping.test.ts`

- [ ] **Step 1: テストを書く（失敗させる）**

`src/renderer/src/lib/grouping.test.ts` を作成する:

```ts
import { describe, it, expect } from 'vitest'
import { buildGroupedView, computeReorder, UNGROUPED_ID } from './grouping'
import type { ConnectionGroup, ConnectionProfile } from '../../../shared/types'

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
    const g1 = views.find((v) => v.id === 'g1')!
    expect(g1.subgroups.map((s) => s.tag)).toEqual(['production', 'local'])
    expect(g1.count).toBe(2)
  })

  it('未知の groupId を指す接続は未分類へ', () => {
    const profiles = [prof({ id: 'a', groupId: 'ghost' })]
    const views = buildGroupedView(profiles, groups, '')
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/renderer/src/lib/grouping.test.ts`
Expected: FAIL（`./grouping` が存在しない）

- [ ] **Step 3: `grouping.ts` を実装**

`src/renderer/src/lib/grouping.ts` を作成する:

```ts
import type { ConnectionGroup, ConnectionProfile, ConnectionTag } from '../../../shared/types'
import { TAG_ORDER } from './tags'
import { filterProfiles } from '../store/helpers'

export const UNGROUPED_ID = '__ungrouped__'
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/renderer/src/lib/grouping.test.ts`
Expected: PASS（全 9 ケース）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/grouping.ts src/renderer/src/lib/grouping.test.ts
git commit -m "feat: グルーピング/並び替えの純関数 buildGroupedView・computeReorder を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: ストアにグループ状態とアクションを追加

`useAppStore` に `groups` / `collapsed` と各アクションを追加し、`App.tsx` で初期ロードする。

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 型 import に `ConnectionGroup` を追加**

`src/renderer/src/store/useAppStore.ts` の型 import（2〜13行目）の `ConnectionProfileInput,` の次に追加する:

```ts
  ConnectionProfileInput,
  ConnectionGroup,
```

- [ ] **Step 2: `AppState` にフィールドとアクション宣言を追加**

`AppState` インターフェースの `search: string` 行（111行目付近）の直後に追加する:

```ts
  search: string
  groups: ConnectionGroup[]
  collapsed: Record<string, boolean> // key=groupId（未分類は UNGROUPED_ID）, true=折り畳み
```

同インターフェース内、`deleteProfile` 宣言行の直後に追加する:

```ts
  deleteProfile: (id: string) => Promise<void>
  loadGroups: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  reorderGroups: (orderedIds: string[]) => Promise<void>
  moveProfileToGroup: (profileId: string, groupId: string | null) => Promise<void>
  toggleCollapse: (groupId: string) => void
```

- [ ] **Step 3: 初期状態を追加**

`return {` ブロック内の `search: '',`（258行目付近）の直後に追加する:

```ts
    search: '',
    groups: [],
    collapsed: {},
```

- [ ] **Step 4: アクション実装を追加**

`deleteProfile` アクションの実装ブロック（`async deleteProfile(id) { ... },`）の直後に追加する:

```ts
    async loadGroups() {
      const res = await window.api.groups.list()
      if (res.ok) set({ groups: res.data })
    },

    async createGroup(name) {
      const res = await window.api.groups.create(name)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
    },

    async renameGroup(id, name) {
      const res = await window.api.groups.rename(id, name)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
    },

    async deleteGroup(id) {
      const res = await window.api.groups.delete(id)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
      await get().loadProfiles()
    },

    async reorderGroups(orderedIds) {
      const res = await window.api.groups.reorder(orderedIds)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
    },

    async moveProfileToGroup(profileId, groupId) {
      const res = await window.api.connections.move(profileId, groupId)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadProfiles()
    },

    toggleCollapse(groupId) {
      set((s) => ({ collapsed: { ...s.collapsed, [groupId]: !s.collapsed[groupId] } }))
    },
```

- [ ] **Step 5: `App.tsx` で初期ロード**

`src/renderer/src/App.tsx` の該当 effect を置換する:

```tsx
  const loadProfiles = useAppStore((s) => s.loadProfiles)
  const loadGroups = useAppStore((s) => s.loadGroups)

  useEffect(() => {
    void loadProfiles()
    void loadGroups()
  }, [loadProfiles, loadGroups])
```

- [ ] **Step 6: 型チェック・テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/useAppStore.ts src/renderer/src/App.tsx
git commit -m "feat: ストアにグループ状態・折り畳み・グループ操作アクションを追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `ConnectionRow` をドラッグ可能にする

**Files:**
- Modify: `src/renderer/src/home/ConnectionRow.tsx`

- [ ] **Step 1: 行に drag 属性を付与**

`src/renderer/src/home/ConnectionRow.tsx` のルート `div`（`className={styles.row}` の要素）を置換する:

```tsx
  return (
    <div
      className={styles.row}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-tableplus-conn', profile.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDoubleClick={() => void connect(profile)}
    >
```

（他の中身・閉じタグは変更しない。`onDoubleClick` は既存のものを維持する。）

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/home/ConnectionRow.tsx
git commit -m "feat: 接続行をドラッグ可能にし profileId を dataTransfer へ載せる

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `GroupSection` コンポーネントと CSS

グループ見出し（折り畳み・リネーム・削除）と、接続ドロップ／グループ並び替えのネイティブ DnD を実装する。

**Files:**
- Create: `src/renderer/src/home/GroupSection.tsx`
- Create: `src/renderer/src/home/GroupSection.module.css`

- [ ] **Step 1: `GroupSection.tsx` を作成**

```tsx
import { useState, type DragEvent } from 'react'
import { useAppStore } from '../store/useAppStore'
import { TAG_COLORS, TAG_LABELS } from '../lib/tags'
import { computeReorder, type GroupView } from '../lib/grouping'
import ConnectionRow from './ConnectionRow'
import styles from './GroupSection.module.css'

const CONN_MIME = 'application/x-tableplus-conn'
const GROUP_MIME = 'application/x-tableplus-group'

export default function GroupSection({
  view,
  collapsed,
  searching
}: {
  view: GroupView
  collapsed: boolean
  searching: boolean
}): JSX.Element {
  const groups = useAppStore((s) => s.groups)
  const toggleCollapse = useAppStore((s) => s.toggleCollapse)
  const renameGroup = useAppStore((s) => s.renameGroup)
  const deleteGroup = useAppStore((s) => s.deleteGroup)
  const reorderGroups = useAppStore((s) => s.reorderGroups)
  const moveProfileToGroup = useAppStore((s) => s.moveProfileToGroup)

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(view.name)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropActive, setDropActive] = useState(false)

  const expanded = searching || !collapsed
  const targetGroupId = view.isUngrouped ? null : view.id

  function onDragOver(e: DragEvent): void {
    const types = e.dataTransfer.types
    const accepts =
      types.includes(CONN_MIME) || (types.includes(GROUP_MIME) && !view.isUngrouped)
    if (accepts) {
      e.preventDefault()
      setDropActive(true)
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    setDropActive(false)
    const connId = e.dataTransfer.getData(CONN_MIME)
    if (connId) {
      void moveProfileToGroup(connId, targetGroupId)
      return
    }
    const groupId = e.dataTransfer.getData(GROUP_MIME)
    if (groupId && !view.isUngrouped) {
      const ordered = [...groups].sort((a, b) => a.order - b.order).map((g) => g.id)
      const next = computeReorder(ordered, groupId, view.id)
      if (next.join('|') !== ordered.join('|')) void reorderGroups(next)
    }
  }

  function commitRename(): void {
    setRenaming(false)
    const name = draft.trim()
    if (name && name !== view.name) void renameGroup(view.id, name)
    else setDraft(view.name)
  }

  return (
    <div
      className={`${styles.group} ${dropActive ? styles.dropActive : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div
        className={styles.header}
        draggable={!view.isUngrouped && !renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(GROUP_MIME, view.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onContextMenu={(e) => {
          if (view.isUngrouped) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <button
          className={styles.caret}
          onClick={() => toggleCollapse(view.id)}
          disabled={searching}
          title={expanded ? '折り畳む' : '展開する'}
        >
          {expanded ? '▼' : '▶'}
        </button>
        {renaming ? (
          <input
            className={styles.renameInput}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setRenaming(false)
                setDraft(view.name)
              }
            }}
          />
        ) : (
          <span
            className={styles.name}
            onDoubleClick={() => {
              if (!view.isUngrouped) {
                setDraft(view.name)
                setRenaming(true)
              }
            }}
          >
            {view.name}
          </span>
        )}
        <span className={styles.count}>{view.count}</span>
      </div>

      {expanded &&
        view.subgroups.map((sg) => (
          <div key={sg.tag} className={styles.sub}>
            <div className={styles.subHead}>
              <span className={styles.dot} style={{ background: TAG_COLORS[sg.tag] }} />
              {TAG_LABELS[sg.tag] || 'その他'}
            </div>
            {sg.profiles.map((p) => (
              <ConnectionRow key={p.id} profile={p} />
            ))}
          </div>
        ))}

      {menu && (
        <>
          <div className={styles.menuBackdrop} onMouseDown={() => setMenu(null)} />
          <div
            className={styles.menu}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className={styles.menuItem}
              onClick={() => {
                setMenu(null)
                if (
                  window.confirm(
                    `グループ「${view.name}」を削除します。中の接続は未分類へ移動します。よろしいですか？`
                  )
                ) {
                  void deleteGroup(view.id)
                }
              }}
            >
              グループを削除
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `GroupSection.module.css` を作成**

```css
.group {
  border-radius: 8px;
  margin: 2px 6px;
}
.dropActive {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--bg-subtle);
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: grab;
  user-select: none;
}
.header:hover {
  background: var(--bg-subtle);
  border-radius: 6px;
}
.caret {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 10px;
  width: 16px;
  cursor: pointer;
}
.caret:disabled {
  opacity: 0.4;
  cursor: default;
}
.name {
  font-weight: 700;
  font-size: 13px;
  color: var(--text);
}
.renameInput {
  font-weight: 700;
  font-size: 13px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 1px 5px;
  outline: none;
}
.count {
  font-size: 11px;
  color: var(--text-faint);
  background: var(--bg-subtle);
  border-radius: 9px;
  padding: 0 7px;
  margin-left: 4px;
}
.sub {
  margin-left: 8px;
}
.subHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 16px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: lowercase;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.menuBackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.menu {
  position: fixed;
  z-index: 41;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 4px;
  min-width: 160px;
}
.menuItem {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 7px 10px;
  font-size: 12px;
  color: #c0392b;
  border-radius: 6px;
  cursor: pointer;
}
.menuItem:hover {
  background: #fdecea;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/home/GroupSection.tsx src/renderer/src/home/GroupSection.module.css
git commit -m "feat: グループ見出し（折り畳み/リネーム/削除）と DnD の GroupSection を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: `ConnectionList` をグループ描画に差し替え、「＋グループ」を追加

**Files:**
- Modify: `src/renderer/src/home/ConnectionList.tsx`
- Modify: `src/renderer/src/home/HomeScreen.tsx`

- [ ] **Step 1: `ConnectionList.tsx` を差し替え**

`src/renderer/src/home/ConnectionList.tsx` を全置換する:

```tsx
import { useAppStore } from '../store/useAppStore'
import { buildGroupedView } from '../lib/grouping'
import GroupSection from './GroupSection'
import styles from './ConnectionList.module.css'

export default function ConnectionList(): JSX.Element {
  const profiles = useAppStore((s) => s.profiles)
  const groups = useAppStore((s) => s.groups)
  const search = useAppStore((s) => s.search)
  const collapsed = useAppStore((s) => s.collapsed)
  const views = buildGroupedView(profiles, groups, search)
  const searching = search.trim().length > 0

  if (profiles.length === 0) {
    return <div className={styles.empty}>＋ から最初の接続を作成してください</div>
  }
  if (views.length === 0) {
    return <div className={styles.empty}>「{search}」に一致する接続はありません</div>
  }
  return (
    <div className={styles.list}>
      {views.map((v) => (
        <GroupSection key={v.id} view={v} collapsed={!!collapsed[v.id]} searching={searching} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: `HomeScreen.tsx` に「＋グループ」ボタンを追加**

`src/renderer/src/home/HomeScreen.tsx` の selector 群に `createGroup` を追加する（`const openForm = ...` の次の行）:

```tsx
  const openForm = useAppStore((s) => s.openForm)
  const createGroup = useAppStore((s) => s.createGroup)
```

`top` 行の新規接続ボタン（`title="新規接続"` の `</button>` まで）の直後に、グループ作成ボタンを追加する:

```tsx
          <button className={styles.plus} onClick={() => openForm()} title="新規接続">
            ＋
          </button>
          <button
            className={styles.plus}
            title="新規グループ"
            onClick={() => {
              const name = window.prompt('新しいグループ名')
              if (name && name.trim()) void createGroup(name.trim())
            }}
          >
            🗂
          </button>
```

- [ ] **Step 3: 型チェック・テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: 手動確認（Electron 起動）**

Run: `npm run dev`
確認項目:
1. 既存接続が「未分類」グループ配下に、tag ごとのサブ見出し付きで表示される。
2. 「🗂」でグループを作成 → 見出しが追加される。
3. 接続行をグループ見出しへドラッグ&ドロップ → そのグループへ移動し、tag サブに並ぶ。
4. グループ見出しをドラッグして並び替え → 順序が変わり、再起動後も保持される。
5. グループ名ダブルクリックでリネーム、右クリックで削除（中の接続は未分類へ）。
6. 検索すると一致接続だけ残り、空グループが隠れる。
7. 折り畳み「▼/▶」が機能する。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/home/ConnectionList.tsx src/renderer/src/home/HomeScreen.tsx
git commit -m "feat: コネクション一覧を2階層グループ表示にし「＋グループ」を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 完了条件

- [ ] `npm run typecheck` が通る
- [ ] `npm test` が全て通る（`ProfileStore` / `GroupStore` / `grouping` のテスト緑）
- [ ] `npm run dev` で Task 10 Step 4 の手動確認項目をすべて満たす
- [ ] 既存の `connections.json`（groups 無し）が壊れず、全接続が「未分類」に表示される（マイグレーション）

## 補足・既知のフォローアップ（v1スコープ外）

- 折り畳み状態はディスク非永続（再起動で全展開）。
- DnD のドロップインジケータは最小限（グループ枠のハイライトのみ）。挿入位置の細い線などは未実装。
- グループ見出しの context menu は端で見切れる可能性（既存メニューと同様の既知制約）。
- `none` タグの接続はサブ見出し「その他」に入る。
