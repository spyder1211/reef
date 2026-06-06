# UI 基盤スライス（Native Light シェル）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現状の最小UI（インラインstyleの単一フォーム）を、macOS 標準アプリ風（Native Light）の「保存済み接続リスト（ホーム）↔ サイドバー＋タブ＋CodeMirrorエディタ＋結果グリッド（Workspace）」の2画面シェルに作り替える。

**Architecture:** Electron のメイン/preload/レンダラ分離を踏襲。メインに `ProfileStore`（接続の永続化＋パスワード暗号化）と `ConnectionManager.listTables()` を追加し、IPC/preload で公開。レンダラは Zustand 単一ストア＋小さなコンポーネント群に再構成し、インラインstyle を廃して `theme.css`（デザイントークン）＋CSS Modules にする。

**Tech Stack:** Electron / TypeScript / React / Vite / Zustand / CodeMirror 6（`@uiw/react-codemirror` + `@codemirror/lang-sql`）/ TanStack Table（`@tanstack/react-table`）/ mysql2 / Electron `safeStorage` / Vitest。

**設計書:** [`../specs/2026-06-06-ui-shell-native-light-design.md`](../specs/2026-06-06-ui-shell-native-light-design.md)

---

## 凡例・前提

- 作業ブランチは現在の `feat/foundation`。各タスク末尾でコミットする。
- テスト: `npx vitest run <path>` で個別実行。型チェック: `npm run typecheck`。dev 起動: `npm run dev`。
- 既存の流儀: IPC は `ApiResult<T>` を返し例外を投げない／エラーは `normalizeDbError` で整形／ユニットテストはソース隣に `*.test.ts`（Vitest, node 環境）。
- 一意ID は Node 22 / Chromium 双方で使える `crypto.randomUUID()` を使う。

---

## Phase 0: 依存追加と共有型・デザイントークン

### Task 1: 依存パッケージの追加

**Files:**
- Modify: `package.json`（devDependencies）

- [ ] **Step 1: レンダラ用ライブラリをインストール**

Run:
```bash
npm install -D @uiw/react-codemirror@^4 @codemirror/lang-sql@^6 @tanstack/react-table@^8
```
Expected: `package.json` の `devDependencies` に3パッケージが追加され、`node_modules` に展開される（`@uiw/react-codemirror` が CodeMirror コアを依存として引き込む）。

- [ ] **Step 2: インストール確認**

Run: `node -e "require.resolve('@uiw/react-codemirror'); require.resolve('@codemirror/lang-sql'); require.resolve('@tanstack/react-table'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: コミット**

```bash
git add package.json package-lock.json
git commit -m "build: CodeMirror と TanStack Table を追加"
```

---

### Task 2: 共有型に接続プロファイルを追加

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 型を追記**

`src/shared/types.ts` の末尾に追加:

```ts
// 接続プロファイル（保存済み接続）
export type ConnectionTag = 'production' | 'staging' | 'development' | 'local' | 'none'

// レンダラに渡す形（パスワードは含めない）
export interface ConnectionProfile {
  id: string
  name: string
  tag: ConnectionTag
  host: string
  port: number
  user: string
  database?: string
}

// 保存・更新の入力（パスワードを含む。保存後はメインのみが暗号化保持）
export interface ConnectionProfileInput {
  id?: string
  name: string
  tag: ConnectionTag
  host: string
  port: number
  user: string
  password: string
  database?: string
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS（既存コードに影響なし）

- [ ] **Step 3: コミット**

```bash
git add src/shared/types.ts
git commit -m "feat: 共有型に ConnectionProfile を追加"
```

---

### Task 3: デザイントークン（theme.css）と全体リセット

**Files:**
- Create: `src/renderer/src/theme.css`
- Modify: `src/renderer/src/main.tsx`

- [ ] **Step 1: theme.css を作成**

`src/renderer/src/theme.css`:

```css
:root {
  --bg: #ffffff;
  --bg-sidebar: #f5f5f7;
  --bg-rail: #f0f0f2;
  --bg-subtle: #f0f0f2;
  --border: #e5e5ea;
  --border-soft: #ededf0;
  --text: #1d1d1f;
  --text-muted: #86868b;
  --text-faint: #9a9aa0;
  --accent: #0a6cff;
  --accent-fg: #ffffff;
  --row-alt: #fafafb;
  --radius: 8px;
  --radius-lg: 12px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "SF Mono", Menlo, monospace;
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: var(--font);
  color: var(--text);
  background: var(--bg);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
button { font-family: inherit; cursor: pointer; }
input, textarea { font-family: inherit; }
```

- [ ] **Step 2: main.tsx で読み込む**

`src/renderer/src/main.tsx` の import 群の先頭付近に追加:

```tsx
import './theme.css'
```

（`import App from './App'` の上に置く）

- [ ] **Step 3: 起動して背景・フォントが変わることを確認**

Run: `npm run dev`
Expected: アプリが起動し、フォントが system フォント・背景白になる（中身は現状のまま）。確認後 Ctrl+C で停止。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/theme.css src/renderer/src/main.tsx
git commit -m "feat: Native Light デザイントークン(theme.css)を追加"
```

---

## Phase 1: メインプロセス（永続化・テーブル一覧）— TDD

### Task 4: ProfileStore（接続の永続化＋パスワード暗号化）

`ProfileStore` は I/O と暗号を**注入**する設計にし、electron 非依存でユニットテストする。

**Files:**
- Create: `src/main/connection/ProfileStore.ts`
- Test: `src/main/connection/ProfileStore.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/connection/ProfileStore.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/ProfileStore.test.ts`
Expected: FAIL（`ProfileStore` 未実装）

- [ ] **Step 3: ProfileStore を実装**

`src/main/connection/ProfileStore.ts`:

```ts
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
    const stored: StoredProfile = {
      id,
      name: input.name,
      tag: input.tag,
      host: input.host,
      port: input.port,
      user: input.user,
      database: input.database,
      encryptedPassword: this.deps.secret.encrypt(input.password)
    }
    const idx = profiles.findIndex((p) => p.id === id)
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/connection/ProfileStore.test.ts`
Expected: PASS（5件）

- [ ] **Step 5: コミット**

```bash
git add src/main/connection/ProfileStore.ts src/main/connection/ProfileStore.test.ts
git commit -m "feat: ProfileStore (接続の永続化/暗号化) を追加 (TDD)"
```

---

### Task 5: createProfileStore（fs ＋ safeStorage の本番 deps）

電子依存の組み立て。ユニットテストは行わず（electron ランタイム必須）、型チェックで担保。

**Files:**
- Create: `src/main/connection/createProfileStore.ts`

- [ ] **Step 1: 実装**

`src/main/connection/createProfileStore.ts`:

```ts
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
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/main/connection/createProfileStore.ts
git commit -m "feat: createProfileStore (fs+safeStorage deps) を追加"
```

---

### Task 6: テーブル名抽出ヘルパー（純関数）— TDD

`SHOW TABLES` の戻り行から名前配列を取り出す純関数を切り出してテストする。

**Files:**
- Create: `src/main/connection/extractTableNames.ts`
- Test: `src/main/connection/extractTableNames.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/connection/extractTableNames.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractTableNames } from './extractTableNames'

describe('extractTableNames', () => {
  it('SHOW TABLES の行（先頭カラム値）を名前配列にする', () => {
    const rows = [{ Tables_in_app: 'users' }, { Tables_in_app: 'orders' }]
    expect(extractTableNames(rows)).toEqual(['users', 'orders'])
  })

  it('空配列なら空', () => {
    expect(extractTableNames([])).toEqual([])
  })

  it('空文字の名前は除外する', () => {
    expect(extractTableNames([{ Tables_in_app: '' }, { Tables_in_app: 'ok' }])).toEqual(['ok'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/extractTableNames.test.ts`
Expected: FAIL（未実装）

- [ ] **Step 3: 実装**

`src/main/connection/extractTableNames.ts`:

```ts
export function extractTableNames(rows: Record<string, unknown>[]): string[] {
  return rows
    .map((r) => String(Object.values(r)[0] ?? ''))
    .filter((name) => name.length > 0)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/connection/extractTableNames.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: コミット**

```bash
git add src/main/connection/extractTableNames.ts src/main/connection/extractTableNames.test.ts
git commit -m "feat: extractTableNames 純関数を追加 (TDD)"
```

---

### Task 7: ConnectionManager.listTables()（結合テスト）

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`
- Modify: `src/main/connection/ConnectionManager.integration.test.ts`

- [ ] **Step 1: 失敗する結合テストを追記**

`src/main/connection/ConnectionManager.integration.test.ts` の `describe.skipIf(...)` ブロック内、最後の `it` の後に追加:

```ts
  it('listTables でテーブル名一覧が返る', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS lt_demo (id INT)')
    const tables = await mgr.listTables()
    expect(tables).toContain('lt_demo')
  })
```

- [ ] **Step 2: DB がある環境で失敗を確認（DBなしならスキップでOK）**

Run（MySQL を docker で起動している場合）:
```bash
TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts
```
Expected: 新規テストが FAIL（`mgr.listTables is not a function`）。DB が無い環境では `skipped` となるので、その場合は Step 3 へ進み型チェックで担保する。

- [ ] **Step 3: listTables を実装**

`src/main/connection/ConnectionManager.ts` の import に追加:

```ts
import { extractTableNames } from './extractTableNames'
```

`query()` メソッドの後ろ（`isConnected()` の前）に追加:

```ts
  async listTables(): Promise<string[]> {
    const { rows } = await this.query('SHOW TABLES')
    return extractTableNames(rows)
  }
```

- [ ] **Step 4: 確認**

Run: `npm run typecheck`
Expected: PASS
（DB あり環境なら Step 2 のコマンドで PASS を確認）

- [ ] **Step 5: コミット**

```bash
git add src/main/connection/ConnectionManager.ts src/main/connection/ConnectionManager.integration.test.ts
git commit -m "feat: ConnectionManager.listTables を追加 (結合)"
```

---

## Phase 2: IPC ＋ preload 配線

### Task 8: 接続プロファイル用 IPC ハンドラ

**Files:**
- Create: `src/main/ipc/registerConnectionHandlers.ts`
- Modify: `src/main/ipc/registerDbHandlers.ts`（`db:listTables` 追加）

- [ ] **Step 1: registerConnectionHandlers を実装**

`src/main/ipc/registerConnectionHandlers.ts`:

```ts
import { ipcMain } from 'electron'
import { ConnectionManager } from '../connection/ConnectionManager'
import { ProfileStore } from '../connection/ProfileStore'
import { validateConnectionConfig } from '../connection/validateConnectionConfig'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ApiResult, ConnectionProfile, ConnectionProfileInput } from '../../shared/types'

export function registerConnectionHandlers(manager: ConnectionManager, store: ProfileStore): void {
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
}
```

- [ ] **Step 2: db:listTables を registerDbHandlers に追加**

`src/main/ipc/registerDbHandlers.ts` の import 行を更新（`QueryResult` の隣に追記）し、`db:disconnect` ハンドラの後に追加:

```ts
  ipcMain.handle('db:listTables', async (): Promise<ApiResult<string[]>> => {
    try {
      return { ok: true, data: await manager.listTables() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/main/ipc/registerConnectionHandlers.ts src/main/ipc/registerDbHandlers.ts
git commit -m "feat: 接続プロファイル/listTables の IPC ハンドラを追加"
```

---

### Task 9: main 起動配線 ＋ preload ＋ env.d.ts

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: main/index.ts で store とハンドラを配線**

`src/main/index.ts` の import に追加:

```ts
import { registerConnectionHandlers } from './ipc/registerConnectionHandlers'
import { createProfileStore } from './connection/createProfileStore'
```

`app.whenReady().then(() => { ... })` の中、`registerDbHandlers(new ConnectionManager())` の行を次に置き換える:

```ts
  const manager = new ConnectionManager()
  registerDbHandlers(manager)
  registerConnectionHandlers(manager, createProfileStore())
```

- [ ] **Step 2: preload に API を追加**

`src/preload/index.ts` を次の内容に置き換える:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput
} from '../shared/types'

const api = {
  connect: (config: ConnectionConfig): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:connect', config),
  query: (sql: string): Promise<ApiResult<QueryResult>> => ipcRenderer.invoke('db:query', sql),
  disconnect: (): Promise<ApiResult<null>> => ipcRenderer.invoke('db:disconnect'),
  listTables: (): Promise<ApiResult<string[]>> => ipcRenderer.invoke('db:listTables'),
  connections: {
    list: (): Promise<ApiResult<ConnectionProfile[]>> => ipcRenderer.invoke('connections:list'),
    save: (input: ConnectionProfileInput): Promise<ApiResult<ConnectionProfile>> =>
      ipcRenderer.invoke('connections:save', input),
    delete: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:delete', id),
    connect: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:connect', id)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **Step 3: env.d.ts の Window 型を更新**

`src/renderer/src/env.d.ts` を次の内容に置き換える:

```ts
/// <reference types="vite/client" />
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput
} from '../../shared/types'

declare global {
  interface Window {
    api: {
      connect: (config: ConnectionConfig) => Promise<ApiResult<null>>
      query: (sql: string) => Promise<ApiResult<QueryResult>>
      disconnect: () => Promise<ApiResult<null>>
      listTables: () => Promise<ApiResult<string[]>>
      connections: {
        list: () => Promise<ApiResult<ConnectionProfile[]>>
        save: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
        delete: (id: string) => Promise<ApiResult<null>>
        connect: (id: string) => Promise<ApiResult<null>>
      }
    }
  }
}
```

- [ ] **Step 4: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: 接続プロファイル API を main/preload に配線"
```

---

## Phase 3: レンダラ基盤（ヘルパー・ストア・ルーター）

### Task 10: 純ヘルパーとタグ定義 — TDD

**Files:**
- Create: `src/renderer/src/store/helpers.ts`
- Create: `src/renderer/src/lib/tags.ts`
- Test: `src/renderer/src/store/helpers.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/store/helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSelectQuery, filterProfiles, pickNextActiveTabId } from './helpers'
import { initials } from '../lib/tags'

describe('buildSelectQuery', () => {
  it('バッククォート付きの SELECT を作る', () => {
    expect(buildSelectQuery('users')).toBe('SELECT * FROM `users` LIMIT 100;')
  })
})

describe('filterProfiles', () => {
  const profiles = [
    { id: '1', name: 'prod-api', host: 'db.example.com', database: 'api' },
    { id: '2', name: 'local', host: '127.0.0.1', database: 'app' }
  ]
  it('空検索は全件', () => {
    expect(filterProfiles(profiles, '')).toHaveLength(2)
  })
  it('名前/ホスト/DB を横断して部分一致', () => {
    expect(filterProfiles(profiles, 'example').map((p) => p.id)).toEqual(['1'])
    expect(filterProfiles(profiles, 'APP').map((p) => p.id)).toEqual(['2'])
  })
})

describe('pickNextActiveTabId', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('非アクティブを閉じてもアクティブは変わらない', () => {
    expect(pickNextActiveTabId(tabs, 'a', 'b')).toBe('b')
  })
  it('アクティブを閉じたら同位置（無ければ末尾）の隣を選ぶ', () => {
    expect(pickNextActiveTabId(tabs, 'b', 'b')).toBe('c')
    expect(pickNextActiveTabId(tabs, 'c', 'c')).toBe('b')
  })
  it('最後の1つを閉じたら null', () => {
    expect(pickNextActiveTabId([{ id: 'a' }], 'a', 'a')).toBeNull()
  })
})

describe('initials', () => {
  it('英数字名は先頭2文字', () => {
    expect(initials('point_invoice')).toBe('po')
  })
  it('日本語名も2文字', () => {
    expect(initials('城下町bot')).toBe('城下')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/helpers.test.ts`
Expected: FAIL（未実装）

- [ ] **Step 3: tags.ts を実装**

`src/renderer/src/lib/tags.ts`:

```ts
import type { ConnectionTag } from '../../../shared/types'

export const TAG_ORDER: ConnectionTag[] = ['production', 'staging', 'development', 'local', 'none']

export const TAG_COLORS: Record<ConnectionTag, string> = {
  production: '#ff453a',
  staging: '#0a84ff',
  development: '#30b0c7',
  local: '#34c759',
  none: '#8e8e93'
}

export const TAG_LABELS: Record<ConnectionTag, string> = {
  production: 'production',
  staging: 'staging',
  development: 'development',
  local: 'local',
  none: ''
}

export function initials(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9぀-ヿ一-龯]/g, '')
  return cleaned.slice(0, 2).toLowerCase() || '??'
}
```

- [ ] **Step 4: helpers.ts を実装**

`src/renderer/src/store/helpers.ts`:

```ts
export function buildSelectQuery(table: string): string {
  return `SELECT * FROM \`${table}\` LIMIT 100;`
}

export function filterProfiles<T extends { name: string; host: string; database?: string }>(
  profiles: T[],
  search: string
): T[] {
  const q = search.trim().toLowerCase()
  if (!q) return profiles
  return profiles.filter((p) =>
    `${p.name} ${p.host} ${p.database ?? ''}`.toLowerCase().includes(q)
  )
}

export function pickNextActiveTabId(
  tabs: { id: string }[],
  closingId: string,
  activeId: string | null
): string | null {
  if (activeId !== closingId) return activeId
  const idx = tabs.findIndex((t) => t.id === closingId)
  const remaining = tabs.filter((t) => t.id !== closingId)
  if (remaining.length === 0) return null
  return (remaining[idx] ?? remaining[remaining.length - 1]).id
}
```

注: `initials('city')` 等は小文字2文字。日本語は `toLowerCase()` が無影響なのでそのまま。

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/helpers.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/store/helpers.ts src/renderer/src/store/helpers.test.ts src/renderer/src/lib/tags.ts
git commit -m "feat: レンダラの純ヘルパーとタグ定義を追加 (TDD)"
```

---

### Task 11: Zustand アプリストア

**Files:**
- Create: `src/renderer/src/store/useAppStore.ts`

- [ ] **Step 1: ストアを実装**

`src/renderer/src/store/useAppStore.ts`:

```ts
import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult
} from '../../../shared/types'
import { buildSelectQuery, pickNextActiveTabId } from './helpers'

export interface Tab {
  id: string
  title: string
  sql: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
}

export type Status = 'idle' | 'connecting' | 'connected' | 'error'

function genId(): string {
  return crypto.randomUUID()
}

function makeTab(index: number): Tab {
  return {
    id: genId(),
    title: `Query ${index}`,
    sql: 'SELECT 1 AS one;',
    result: null,
    error: null,
    running: false
  }
}

interface AppState {
  profiles: ConnectionProfile[]
  search: string
  status: Status
  connectError: AppError | null
  activeProfile: ConnectionProfile | null
  tables: string[]
  tabs: Tab[]
  activeTabId: string | null
  formOpen: boolean
  editingId: string | null

  loadProfiles: () => Promise<void>
  setSearch: (s: string) => void
  openForm: (id?: string) => void
  closeForm: () => void
  saveProfile: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
  deleteProfile: (id: string) => Promise<void>
  connect: (profile: ConnectionProfile) => Promise<void>
  disconnect: () => Promise<void>
  addTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setTabSql: (id: string, sql: string) => void
  runActiveTab: () => Promise<void>
  selectTable: (name: string) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  profiles: [],
  search: '',
  status: 'idle',
  connectError: null,
  activeProfile: null,
  tables: [],
  tabs: [],
  activeTabId: null,
  formOpen: false,
  editingId: null,

  async loadProfiles() {
    const res = await window.api.connections.list()
    if (res.ok) set({ profiles: res.data })
  },

  setSearch(s) {
    set({ search: s })
  },

  openForm(id) {
    set({ formOpen: true, editingId: id ?? null })
  },

  closeForm() {
    set({ formOpen: false, editingId: null })
  },

  async saveProfile(input) {
    const res = await window.api.connections.save(input)
    if (res.ok) await get().loadProfiles()
    return res
  },

  async deleteProfile(id) {
    await window.api.connections.delete(id)
    await get().loadProfiles()
  },

  async connect(profile) {
    set({ status: 'connecting', connectError: null })
    const res = await window.api.connections.connect(profile.id)
    if (!res.ok) {
      set({ status: 'error', connectError: res.error })
      return
    }
    const tab = makeTab(1)
    set({
      status: 'connected',
      activeProfile: profile,
      tabs: [tab],
      activeTabId: tab.id,
      tables: []
    })
    const tbl = await window.api.listTables()
    if (tbl.ok) set({ tables: tbl.data })
  },

  async disconnect() {
    await window.api.disconnect()
    set({
      status: 'idle',
      activeProfile: null,
      tables: [],
      tabs: [],
      activeTabId: null,
      connectError: null
    })
  },

  addTab() {
    const tabs = get().tabs
    const tab = makeTab(tabs.length + 1)
    set({ tabs: [...tabs, tab], activeTabId: tab.id })
  },

  closeTab(id) {
    const { tabs, activeTabId } = get()
    const nextActive = pickNextActiveTabId(tabs, id, activeTabId)
    set({ tabs: tabs.filter((t) => t.id !== id), activeTabId: nextActive })
  },

  setActiveTab(id) {
    set({ activeTabId: id })
  },

  setTabSql(id, sql) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, sql } : t)) })
  },

  async runActiveTab() {
    const { activeTabId, tabs } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    set({ tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, running: true, error: null } : t)) })
    const res = await window.api.query(tab.sql)
    set({
      tabs: get().tabs.map((t) =>
        t.id === tab.id
          ? {
              ...t,
              running: false,
              result: res.ok ? res.data : null,
              error: res.ok ? null : res.error
            }
          : t
      )
    })
  },

  async selectTable(name) {
    let id = get().activeTabId
    if (!id) {
      const tab = makeTab(1)
      set({ tabs: [tab], activeTabId: tab.id })
      id = tab.id
    }
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, sql: buildSelectQuery(name) } : t)) })
    await get().runActiveTab()
  }
}))
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: Zustand アプリストアを追加"
```

---

### Task 12: App ルーター化（Home / Workspace 出し分け）

この時点では `HomeScreen` / `WorkspaceShell` は仮実装で配線確認する（中身は次フェーズで作り込む）。

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/home/HomeScreen.tsx`（仮）
- Create: `src/renderer/src/workspace/WorkspaceShell.tsx`（仮）

- [ ] **Step 1: 仮 HomeScreen**

`src/renderer/src/home/HomeScreen.tsx`:

```tsx
export default function HomeScreen(): JSX.Element {
  return <div style={{ padding: 24 }}>Home（接続リスト）— 構築中</div>
}
```

- [ ] **Step 2: 仮 WorkspaceShell**

`src/renderer/src/workspace/WorkspaceShell.tsx`:

```tsx
export default function WorkspaceShell(): JSX.Element {
  return <div style={{ padding: 24 }}>Workspace — 構築中</div>
}
```

- [ ] **Step 3: App.tsx を置き換え**

`src/renderer/src/App.tsx` を次の内容に置き換える（既存の全内容を削除）:

```tsx
import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import HomeScreen from './home/HomeScreen'
import WorkspaceShell from './workspace/WorkspaceShell'

export default function App(): JSX.Element {
  const status = useAppStore((s) => s.status)
  const loadProfiles = useAppStore((s) => s.loadProfiles)

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  return status === 'connected' ? <WorkspaceShell /> : <HomeScreen />
}
```

- [ ] **Step 4: 起動して Home 仮表示を確認**

Run: `npm run dev`
Expected: 「Home（接続リスト）— 構築中」が表示される。コンソールにエラーが無い（`connections:list` が呼ばれ空配列が返る）。確認後 Ctrl+C。

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/App.tsx src/renderer/src/home/HomeScreen.tsx src/renderer/src/workspace/WorkspaceShell.tsx
git commit -m "feat: App を Home/Workspace ルーターに再構成（仮画面）"
```

---

## Phase 4: ホーム画面コンポーネント

### Task 13: Avatar ＋ Tag 共通コンポーネント

**Files:**
- Create: `src/renderer/src/components/Avatar.tsx`
- Create: `src/renderer/src/components/Avatar.module.css`
- Create: `src/renderer/src/components/Tag.tsx`
- Create: `src/renderer/src/components/Tag.module.css`

- [ ] **Step 1: Avatar**

`src/renderer/src/components/Avatar.tsx`:

```tsx
import type { ConnectionTag } from '../../../shared/types'
import { TAG_COLORS, initials } from '../lib/tags'
import styles from './Avatar.module.css'

export default function Avatar({
  name,
  tag,
  size = 32
}: {
  name: string
  tag: ConnectionTag
  size?: number
}): JSX.Element {
  return (
    <div
      className={styles.avatar}
      style={{ width: size, height: size, background: TAG_COLORS[tag], fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  )
}
```

`src/renderer/src/components/Avatar.module.css`:

```css
.avatar {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Tag**

`src/renderer/src/components/Tag.tsx`:

```tsx
import type { ConnectionTag } from '../../../shared/types'
import { TAG_COLORS, TAG_LABELS } from '../lib/tags'
import styles from './Tag.module.css'

export default function Tag({
  tag,
  light = false
}: {
  tag: ConnectionTag
  light?: boolean
}): JSX.Element | null {
  if (tag === 'none') return null
  return (
    <span className={styles.tag} style={{ color: light ? 'rgba(255,255,255,0.85)' : TAG_COLORS[tag] }}>
      {TAG_LABELS[tag]}
    </span>
  )
}
```

`src/renderer/src/components/Tag.module.css`:

```css
.tag {
  font-size: 11px;
  font-weight: 600;
  margin-left: 6px;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/components/
git commit -m "feat: Avatar / Tag 共通コンポーネントを追加"
```

---

### Task 14: AppRail ＋ HomeScreen レイアウト

**Files:**
- Create: `src/renderer/src/home/AppRail.tsx`
- Create: `src/renderer/src/home/AppRail.module.css`
- Modify: `src/renderer/src/home/HomeScreen.tsx`
- Create: `src/renderer/src/home/HomeScreen.module.css`

- [ ] **Step 1: AppRail**

`src/renderer/src/home/AppRail.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import styles from './AppRail.module.css'

export default function AppRail(): JSX.Element {
  const openForm = useAppStore((s) => s.openForm)
  return (
    <div className={styles.rail}>
      <div className={styles.logo}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <ellipse cx="12" cy="5" rx="8" ry="3" fill="#fff" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" stroke="#fff" strokeWidth="1.6" fill="none" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" stroke="#fff" strokeWidth="1.6" fill="none" />
        </svg>
      </div>
      <div className={styles.name}>MySQL Client</div>
      <div className={styles.version}>Version 0.1.0</div>
      <div className={styles.spacer} />
      <button className={styles.railBtn} onClick={() => openForm()}>
        ＋ 新規接続
      </button>
      <button className={styles.railBtn} disabled title="今後対応">
        ⚙ 設定
      </button>
    </div>
  )
}
```

`src/renderer/src/home/AppRail.module.css`:

```css
.rail {
  width: 188px;
  background: var(--bg-rail);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 14px;
  flex-shrink: 0;
}
.logo {
  width: 58px;
  height: 58px;
  border-radius: 14px;
  background: linear-gradient(145deg, #5ea0ff, #0a6cff);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(10, 108, 255, 0.3);
  margin-bottom: 12px;
}
.name {
  font-weight: 700;
  font-size: 15px;
}
.version {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 3px;
}
.spacer {
  flex: 1;
}
.railBtn {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: var(--radius);
  padding: 7px 0;
  font-size: 12px;
  color: var(--text);
  margin-top: 8px;
}
.railBtn:disabled {
  color: var(--text-faint);
  cursor: default;
}
.railBtn:not(:disabled):hover {
  background: #e9e9ee;
}
```

- [ ] **Step 2: HomeScreen レイアウト**

`src/renderer/src/home/HomeScreen.tsx` を置き換え:

```tsx
import { useAppStore } from '../store/useAppStore'
import AppRail from './AppRail'
import styles from './HomeScreen.module.css'

export default function HomeScreen(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const openForm = useAppStore((s) => s.openForm)

  return (
    <div className={styles.home}>
      <AppRail />
      <div className={styles.main}>
        <div className={styles.top}>
          <button className={styles.plus} onClick={() => openForm()} title="新規接続">
            ＋
          </button>
          <input
            className={styles.search}
            placeholder="接続を検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* Task 15 で <ConnectionList /> に置き換える */}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  )
}
```

`src/renderer/src/home/HomeScreen.module.css`:

```css
.home {
  display: flex;
  height: 100%;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
}
.plus {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  flex-shrink: 0;
}
.plus:hover {
  background: var(--bg-subtle);
}
.search {
  flex: 1;
  background: var(--bg-subtle);
  border: none;
  border-radius: var(--radius);
  padding: 7px 12px;
  font-size: 13px;
  color: var(--text);
  outline: none;
}
```

注: ここでは `HomeScreen` の接続リスト枠を空の `div` プレースホルダにしておき、Task 15 で `<ConnectionList />`、Task 16 で接続フォームモーダルを差し込む（各タスクでビルドが緑になる増分構築）。

- [ ] **Step 3: 型チェックと起動確認**

Run: `npm run typecheck && npm run dev`
Expected: 型チェック PASS。左レール（ロゴ／MySQL Client／Version／新規接続・設定）＋上部に「＋」と検索バーが Native Light で表示。確認後 Ctrl+C。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/home/AppRail.tsx src/renderer/src/home/AppRail.module.css src/renderer/src/home/HomeScreen.tsx src/renderer/src/home/HomeScreen.module.css
git commit -m "feat: AppRail と HomeScreen レイアウトを追加"
```

---

### Task 15: ConnectionList ＋ ConnectionRow

**Files:**
- Create: `src/renderer/src/home/ConnectionList.tsx`
- Create: `src/renderer/src/home/ConnectionList.module.css`
- Create: `src/renderer/src/home/ConnectionRow.tsx`
- Create: `src/renderer/src/home/ConnectionRow.module.css`
- Modify: `src/renderer/src/home/HomeScreen.tsx`（プレースホルダを `<ConnectionList />` に差し替え）

- [ ] **Step 1: ConnectionRow**

`src/renderer/src/home/ConnectionRow.tsx`:

```tsx
import type { ConnectionProfile } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import Avatar from '../components/Avatar'
import Tag from '../components/Tag'
import styles from './ConnectionRow.module.css'

export default function ConnectionRow({ profile }: { profile: ConnectionProfile }): JSX.Element {
  const connect = useAppStore((s) => s.connect)
  const openForm = useAppStore((s) => s.openForm)
  const deleteProfile = useAppStore((s) => s.deleteProfile)
  const sub = `${profile.host} : ${profile.database ?? profile.user}`

  return (
    <div className={styles.row} onDoubleClick={() => void connect(profile)}>
      <Avatar name={profile.name} tag={profile.tag} />
      <div className={styles.meta}>
        <div className={styles.nameLine}>
          <span className={styles.name}>{profile.name}</span>
          <Tag tag={profile.tag} />
        </div>
        <div className={styles.sub}>{sub}</div>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            openForm(profile.id)
          }}
        >
          編集
        </button>
        <button
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            void deleteProfile(profile.id)
          }}
        >
          削除
        </button>
        <button
          className={styles.connect}
          onClick={(e) => {
            e.stopPropagation()
            void connect(profile)
          }}
        >
          接続
        </button>
      </div>
    </div>
  )
}
```

`src/renderer/src/home/ConnectionRow.module.css`:

```css
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  cursor: default;
}
.row:hover {
  background: var(--bg-subtle);
}
.meta {
  flex: 1;
  min-width: 0;
}
.nameLine {
  display: flex;
  align-items: baseline;
}
.name {
  font-weight: 600;
  font-size: 13px;
}
.sub {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: none;
  gap: 6px;
  align-items: center;
}
.row:hover .actions {
  display: flex;
}
.action {
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 11px;
  color: var(--text-muted);
}
.action:hover {
  background: #e9e9ee;
}
.connect {
  border: none;
  background: var(--accent);
  color: var(--accent-fg);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
}
```

- [ ] **Step 2: ConnectionList**

`src/renderer/src/home/ConnectionList.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import { filterProfiles } from '../store/helpers'
import ConnectionRow from './ConnectionRow'
import styles from './ConnectionList.module.css'

export default function ConnectionList(): JSX.Element {
  const profiles = useAppStore((s) => s.profiles)
  const search = useAppStore((s) => s.search)
  const shown = filterProfiles(profiles, search)

  if (profiles.length === 0) {
    return <div className={styles.empty}>＋ から最初の接続を作成してください</div>
  }
  if (shown.length === 0) {
    return <div className={styles.empty}>「{search}」に一致する接続はありません</div>
  }
  return (
    <div className={styles.list}>
      {shown.map((p) => (
        <ConnectionRow key={p.id} profile={p} />
      ))}
    </div>
  )
}
```

`src/renderer/src/home/ConnectionList.module.css`:

```css
.list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
  padding: 40px;
}
```

- [ ] **Step 3: HomeScreen にリストを差し込む**

`src/renderer/src/home/HomeScreen.tsx` の import に追加:

```tsx
import ConnectionList from './ConnectionList'
```

そして本文のプレースホルダを差し替える:

```tsx
        {/* Task 15 で <ConnectionList /> に置き換える */}
        <div style={{ flex: 1 }} />
```
↓
```tsx
        <ConnectionList />
```

- [ ] **Step 4: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/home/ConnectionList.tsx src/renderer/src/home/ConnectionList.module.css src/renderer/src/home/ConnectionRow.tsx src/renderer/src/home/ConnectionRow.module.css src/renderer/src/home/HomeScreen.tsx
git commit -m "feat: ConnectionList / ConnectionRow を追加し Home に差し込む"
```

---

### Task 16: ConnectionFormModal（保存／テスト／接続）

**Files:**
- Create: `src/renderer/src/home/ConnectionFormModal.tsx`
- Create: `src/renderer/src/home/ConnectionFormModal.module.css`
- Modify: `src/renderer/src/home/HomeScreen.tsx`（`formOpen` でモーダルを表示）

- [ ] **Step 1: 実装**

`src/renderer/src/home/ConnectionFormModal.tsx`:

```tsx
import { useState, type ReactNode } from 'react'
import type { AppError, ConnectionProfileInput, ConnectionTag } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { TAG_ORDER, TAG_COLORS } from '../lib/tags'
import styles from './ConnectionFormModal.module.css'

function initialForm(): ConnectionProfileInput {
  return { name: '', tag: 'local', host: '127.0.0.1', port: 3306, user: 'root', password: '', database: '' }
}

export default function ConnectionFormModal(): JSX.Element {
  const editingId = useAppStore((s) => s.editingId)
  const profiles = useAppStore((s) => s.profiles)
  const closeForm = useAppStore((s) => s.closeForm)
  const saveProfile = useAppStore((s) => s.saveProfile)
  const connect = useAppStore((s) => s.connect)

  const editing = profiles.find((p) => p.id === editingId) ?? null
  const [form, setForm] = useState<ConnectionProfileInput>(() =>
    editing ? { ...editing, password: '' } : initialForm()
  )
  const [error, setError] = useState<AppError | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok'>('idle')

  function update<K extends keyof ConnectionProfileInput>(key: K, value: ConnectionProfileInput[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
    setTestState('idle')
  }

  async function handleSave(): Promise<void> {
    setError(null)
    const res = await saveProfile(form)
    if (res.ok) closeForm()
    else setError(res.error)
  }

  async function handleConnect(): Promise<void> {
    setError(null)
    const res = await saveProfile(form)
    if (!res.ok) {
      setError(res.error)
      return
    }
    closeForm()
    await connect(res.data)
  }

  async function handleTest(): Promise<void> {
    setError(null)
    setTestState('testing')
    const res = await window.api.connect({
      host: form.host,
      port: form.port,
      user: form.user,
      password: form.password,
      database: form.database
    })
    if (res.ok) {
      setTestState('ok')
      await window.api.disconnect()
    } else {
      setTestState('idle')
      setError(res.error)
    }
  }

  return (
    <div className={styles.backdrop} onClick={closeForm}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>MySQL 接続</div>

        <Field label="名前">
          <input className={styles.input} value={form.name} onChange={(e) => update('name', e.target.value)} autoFocus />
        </Field>

        <Field label="タグ">
          <div className={styles.swatches}>
            {TAG_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.swatch}
                style={{
                  background: TAG_COLORS[t],
                  outline: form.tag === t ? `2px solid ${TAG_COLORS[t]}88` : 'none',
                  outlineOffset: 1
                }}
                title={t}
                onClick={() => update('tag', t as ConnectionTag)}
              />
            ))}
          </div>
        </Field>

        <Field label="Host">
          <input className={styles.input} value={form.host} onChange={(e) => update('host', e.target.value)} />
          <input
            className={styles.port}
            type="number"
            value={form.port}
            onChange={(e) => update('port', Number(e.target.value))}
          />
        </Field>

        <Field label="User">
          <input className={styles.input} value={form.user} onChange={(e) => update('user', e.target.value)} />
        </Field>

        <Field label="Password">
          <input
            className={styles.input}
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>

        <Field label="Database">
          <input
            className={styles.input}
            value={form.database ?? ''}
            onChange={(e) => update('database', e.target.value)}
          />
        </Field>

        <div className={styles.note}>SSH トンネル / SSL は今後対応</div>

        {error && (
          <div className={styles.error}>
            <b>{error.code}</b>: {error.message}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.btn} onClick={() => void handleSave()}>
            保存
          </button>
          <button className={styles.btn} onClick={() => void handleTest()}>
            {testState === 'testing' ? 'テスト中…' : testState === 'ok' ? '✓ 成功' : 'テスト'}
          </button>
          <button className={styles.btnPrimary} onClick={() => void handleConnect()}>
            接続
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className={styles.field}>
      <div className={styles.flabel}>{label}</div>
      <div className={styles.fbody}>{children}</div>
    </div>
  )
}
```

`src/renderer/src/home/ConnectionFormModal.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.modal {
  width: 380px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
  padding: 18px 20px;
}
.title {
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 16px;
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.flabel {
  width: 70px;
  text-align: right;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.fbody {
  flex: 1;
  display: flex;
  gap: 6px;
  align-items: center;
}
.input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 12px;
  color: var(--text);
  outline: none;
  min-width: 0;
}
.input:focus {
  border-color: var(--accent);
}
.port {
  width: 64px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 12px;
  outline: none;
}
.swatches {
  display: flex;
  gap: 8px;
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  padding: 0;
}
.note {
  font-size: 11px;
  color: var(--text-faint);
  text-align: right;
  margin: 6px 0 12px;
}
.error {
  color: #b91c1c;
  font-size: 12px;
  margin-bottom: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  background: var(--bg-subtle);
  color: var(--text);
  border: none;
  border-radius: 7px;
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 600;
}
.btn:hover {
  background: #e4e4e9;
}
.btnPrimary {
  background: var(--accent);
  color: var(--accent-fg);
  border: none;
  border-radius: 7px;
  padding: 7px 18px;
  font-size: 12px;
  font-weight: 600;
}
```

- [ ] **Step 2: HomeScreen にモーダルを差し込む**

`src/renderer/src/home/HomeScreen.tsx` の import に追加:

```tsx
import ConnectionFormModal from './ConnectionFormModal'
```

`HomeScreen` 関数内の hooks に `formOpen` を追加:

```tsx
  const formOpen = useAppStore((s) => s.formOpen)
```

`<ConnectionList />` を含む外側 `<div className={styles.home}>` の閉じタグ直前（`</div>` の手前）にモーダルを追加:

```tsx
      {formOpen && <ConnectionFormModal />}
```

差し込み後の `HomeScreen.tsx` 全体は次の形になる:

```tsx
import { useAppStore } from '../store/useAppStore'
import AppRail from './AppRail'
import ConnectionList from './ConnectionList'
import ConnectionFormModal from './ConnectionFormModal'
import styles from './HomeScreen.module.css'

export default function HomeScreen(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const openForm = useAppStore((s) => s.openForm)
  const formOpen = useAppStore((s) => s.formOpen)

  return (
    <div className={styles.home}>
      <AppRail />
      <div className={styles.main}>
        <div className={styles.top}>
          <button className={styles.plus} onClick={() => openForm()} title="新規接続">
            ＋
          </button>
          <input
            className={styles.search}
            placeholder="接続を検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ConnectionList />
      </div>
      {formOpen && <ConnectionFormModal />}
    </div>
  )
}
```

- [ ] **Step 3: Home 全体を起動確認**

Run: `npm run dev`
Expected:
1. 左レール＋検索バーが表示。
2. 「＋ 新規接続」or 上部「＋」でモーダルが開く。
3. ローカル MySQL（例: 127.0.0.1:3306）の情報を入れて「テスト」→ 成功なら「✓ 成功」、失敗ならエラーコード表示。
4. 「保存」でモーダルが閉じ、接続行（アバター＋名前＋タグ＋host:db）が一覧に出る。
5. 行ホバーで 編集／削除／接続 が出る。
確認後 Ctrl+C。

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/home/ConnectionFormModal.tsx src/renderer/src/home/ConnectionFormModal.module.css src/renderer/src/home/HomeScreen.tsx
git commit -m "feat: ConnectionFormModal (保存/テスト/接続) を追加し Home に差し込む"
```

---

## Phase 5: Workspace コンポーネント

### Task 17: Sidebar ＋ TableList

**Files:**
- Create: `src/renderer/src/workspace/Sidebar.tsx`
- Create: `src/renderer/src/workspace/Sidebar.module.css`
- Create: `src/renderer/src/workspace/TableList.tsx`
- Create: `src/renderer/src/workspace/TableList.module.css`

- [ ] **Step 1: TableList**

`src/renderer/src/workspace/TableList.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import styles from './TableList.module.css'

export default function TableList(): JSX.Element {
  const tables = useAppStore((s) => s.tables)
  const selectTable = useAppStore((s) => s.selectTable)

  return (
    <div className={styles.tables}>
      <div className={styles.label}>TABLES</div>
      {tables.length === 0 ? (
        <div className={styles.empty}>テーブルがありません</div>
      ) : (
        tables.map((t) => (
          <button key={t} className={styles.row} onClick={() => void selectTable(t)} title={t}>
            <span className={styles.icon}>▸</span>
            <span className={styles.tname}>{t}</span>
          </button>
        ))
      )}
    </div>
  )
}
```

`src/renderer/src/workspace/TableList.module.css`:

```css
.tables {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px 12px;
}
.label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 6px 8px 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12.5px;
  color: var(--text);
  text-align: left;
}
.row:hover {
  background: #e9e9ee;
}
.icon {
  color: var(--text-faint);
  font-size: 10px;
}
.tname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  color: var(--text-faint);
  font-size: 12px;
  padding: 8px;
}
```

- [ ] **Step 2: Sidebar**

`src/renderer/src/workspace/Sidebar.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import Avatar from '../components/Avatar'
import TableList from './TableList'
import styles from './Sidebar.module.css'

export default function Sidebar(): JSX.Element {
  const profile = useAppStore((s) => s.activeProfile)
  const disconnect = useAppStore((s) => s.disconnect)

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <Avatar name={profile?.name ?? '?'} tag={profile?.tag ?? 'none'} size={28} />
        <div className={styles.meta}>
          <div className={styles.name}>{profile?.name ?? ''}</div>
          <div className={styles.sub}>
            {profile?.host} : {profile?.database ?? profile?.user}
          </div>
        </div>
      </div>
      <TableList />
      <button className={styles.back} onClick={() => void disconnect()}>
        ← 接続一覧
      </button>
    </div>
  )
}
```

`src/renderer/src/workspace/Sidebar.module.css`:

```css
.sidebar {
  width: 230px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--border);
}
.meta {
  min-width: 0;
}
.name {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: 11px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.back {
  border: none;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  padding: 10px;
  font-size: 12px;
  text-align: left;
}
.back:hover {
  background: #e9e9ee;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/Sidebar.tsx src/renderer/src/workspace/Sidebar.module.css src/renderer/src/workspace/TableList.tsx src/renderer/src/workspace/TableList.module.css
git commit -m "feat: Workspace の Sidebar / TableList を追加"
```

---

### Task 18: TabBar

**Files:**
- Create: `src/renderer/src/workspace/TabBar.tsx`
- Create: `src/renderer/src/workspace/TabBar.module.css`

- [ ] **Step 1: 実装**

`src/renderer/src/workspace/TabBar.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import styles from './TabBar.module.css'

export default function TabBar(): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const addTab = useAppStore((s) => s.addTab)

  return (
    <div className={styles.tabbar}>
      {tabs.map((t) => (
        <div
          key={t.id}
          className={t.id === activeTabId ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab(t.id)}
        >
          <span className={styles.title}>{t.title}</span>
          <button
            className={styles.close}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className={styles.add} onClick={() => addTab()} title="新しいクエリタブ">
        ＋
      </button>
    </div>
  )
}
```

`src/renderer/src/workspace/TabBar.module.css`:

```css
.tabbar {
  display: flex;
  align-items: stretch;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  height: 34px;
}
.tab,
.tabActive {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 12px;
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  max-width: 180px;
}
.tabActive {
  background: var(--bg);
  color: var(--text);
  border-top: 2px solid var(--accent);
}
.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.close {
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 4px;
}
.close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--text);
}
.add {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  padding: 0 12px;
}
.add:hover {
  background: rgba(0, 0, 0, 0.05);
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/workspace/TabBar.tsx src/renderer/src/workspace/TabBar.module.css
git commit -m "feat: Workspace の TabBar を追加"
```

---

### Task 19: QueryEditor（CodeMirror 6）

**Files:**
- Create: `src/renderer/src/workspace/QueryEditor.tsx`
- Create: `src/renderer/src/workspace/QueryEditor.module.css`

- [ ] **Step 1: 実装**

`src/renderer/src/workspace/QueryEditor.tsx`:

```tsx
import CodeMirror from '@uiw/react-codemirror'
import { sql, MySQL } from '@codemirror/lang-sql'
import { keymap } from '@codemirror/view'
import { useAppStore } from '../store/useAppStore'
import styles from './QueryEditor.module.css'

export default function QueryEditor(): JSX.Element | null {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setTabSql = useAppStore((s) => s.setTabSql)
  const runActiveTab = useAppStore((s) => s.runActiveTab)

  if (!tab) return null

  const runKeymap = keymap.of([
    {
      key: 'Mod-Enter',
      run: () => {
        void runActiveTab()
        return true
      }
    }
  ])

  return (
    <div className={styles.editor}>
      <CodeMirror
        key={activeTabId ?? 'none'}
        value={tab.sql}
        height="100%"
        theme="light"
        extensions={[sql({ dialect: MySQL }), runKeymap]}
        basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
        onChange={(value) => setTabSql(tab.id, value)}
      />
      <div className={styles.hint}>⌘↵ で実行</div>
    </div>
  )
}
```

`src/renderer/src/workspace/QueryEditor.module.css`:

```css
.editor {
  position: relative;
  flex: 0 0 40%;
  min-height: 120px;
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}
.editor :global(.cm-editor) {
  height: 100%;
  font-family: var(--font-mono);
  font-size: 13px;
}
.editor :global(.cm-editor.cm-focused) {
  outline: none;
}
.hint {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-size: 11px;
  color: var(--text-faint);
  background: rgba(255, 255, 255, 0.8);
  padding: 2px 6px;
  border-radius: 5px;
  pointer-events: none;
}
```

注: `key={activeTabId}` でタブ切替時にエディタを作り直し、別タブの SQL が確実に反映されるようにする。

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/workspace/QueryEditor.tsx src/renderer/src/workspace/QueryEditor.module.css
git commit -m "feat: CodeMirror の QueryEditor を追加"
```

---

### Task 20: ResultsGrid（TanStack Table）＋ StatusBar

**Files:**
- Create: `src/renderer/src/workspace/ResultsGrid.tsx`
- Create: `src/renderer/src/workspace/ResultsGrid.module.css`
- Create: `src/renderer/src/workspace/StatusBar.tsx`
- Create: `src/renderer/src/workspace/StatusBar.module.css`

- [ ] **Step 1: ResultsGrid**

`src/renderer/src/workspace/ResultsGrid.tsx`:

```tsx
import { useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import type { QueryResult } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import styles from './ResultsGrid.module.css'

type Row = Record<string, unknown>

export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)

  if (!tab) return <div className={styles.placeholder} />
  if (tab.running) return <div className={styles.placeholder}>実行中…</div>
  if (tab.error) {
    return (
      <div className={styles.errorBox}>
        <b>{tab.error.code}</b>: {tab.error.message}
      </div>
    )
  }
  if (!tab.result) {
    return <div className={styles.placeholder}>クエリを実行してください（⌘↵）</div>
  }
  return <Grid result={tab.result} />
}

function Grid({ result }: { result: QueryResult }): JSX.Element {
  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      result.columns.map((c) => ({
        id: c.name,
        header: c.name,
        accessorFn: (row) => row[c.name]
      })),
    [result.columns]
  )

  const table = useReactTable({
    data: result.rows as Row[],
    columns,
    getCoreRowModel: getCoreRowModel()
  })

  if (result.columns.length === 0) {
    return <div className={styles.placeholder}>結果なし（{result.rowCount} 行）</div>
  }

  return (
    <div className={styles.gridWrap}>
      <table className={styles.grid}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const v = cell.getValue()
                return (
                  <td key={cell.id}>
                    {v === null || v === undefined ? (
                      <span className={styles.null}>NULL</span>
                    ) : (
                      String(v)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

`src/renderer/src/workspace/ResultsGrid.module.css`:

```css
.gridWrap {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.grid {
  border-collapse: collapse;
  font-size: 12px;
  width: max-content;
  min-width: 100%;
}
.grid th {
  position: sticky;
  top: 0;
  background: var(--bg-sidebar);
  color: var(--text-muted);
  font-weight: 600;
  text-align: left;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border-soft);
  white-space: nowrap;
}
.grid td {
  padding: 5px 12px;
  border-bottom: 1px solid var(--border-soft);
  border-right: 1px solid var(--border-soft);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.grid tbody tr:nth-child(even) {
  background: var(--row-alt);
}
.null {
  color: var(--text-faint);
  font-style: italic;
}
.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 13px;
}
.errorBox {
  flex: 1;
  padding: 16px;
  color: #b91c1c;
  font-size: 13px;
  overflow: auto;
}
```

- [ ] **Step 2: StatusBar**

`src/renderer/src/workspace/StatusBar.tsx`:

```tsx
import { useAppStore } from '../store/useAppStore'
import { TAG_COLORS } from '../lib/tags'
import styles from './StatusBar.module.css'

export default function StatusBar(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const profile = useAppStore((s) => s.activeProfile)
  const r = tab?.result

  return (
    <div className={styles.status}>
      <span>{r ? `${r.rowCount} 行 · ${r.durationMs} ms` : '—'}</span>
      <span className={styles.right}>
        <span className={styles.dot} style={{ background: TAG_COLORS[profile?.tag ?? 'none'] }} />
        {profile?.name}
      </span>
    </div>
  )
}
```

`src/renderer/src/workspace/StatusBar.module.css`:

```css
.status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
  padding: 0 12px;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css src/renderer/src/workspace/StatusBar.tsx src/renderer/src/workspace/StatusBar.module.css
git commit -m "feat: ResultsGrid (TanStack Table) と StatusBar を追加"
```

---

### Task 21: WorkspaceShell 組み立て ＋ 通し確認

**Files:**
- Modify: `src/renderer/src/workspace/WorkspaceShell.tsx`
- Create: `src/renderer/src/workspace/WorkspaceShell.module.css`

- [ ] **Step 1: WorkspaceShell を本実装に置き換え**

`src/renderer/src/workspace/WorkspaceShell.tsx`:

```tsx
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import ResultsGrid from './ResultsGrid'
import StatusBar from './StatusBar'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.mainCol}>
        <TabBar />
        <QueryEditor />
        <ResultsGrid />
        <StatusBar />
      </div>
    </div>
  )
}
```

`src/renderer/src/workspace/WorkspaceShell.module.css`:

```css
.shell {
  display: flex;
  height: 100%;
}
.mainCol {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
```

- [ ] **Step 2: 通し確認（要ローカル MySQL）**

Run: `npm run dev`
Expected（ローカル MySQL がある前提）:
1. Home で接続行をダブルクリック or「接続」→ Workspace へ遷移。
2. 左サイドバーに接続名・`host:db` と **テーブル一覧（実データ）** が出る。
3. テーブルをクリック → エディタに ``SELECT * FROM `xxx` LIMIT 100;`` が入り、結果グリッドに行が出る。
4. エディタで SQL を編集し **⌘↵** で実行 → 結果更新。
5. 「＋」でタブ追加、「×」で閉じる。アクティブタブが妥当に移る。
6. ステータスバーに `N 行 · M ms` と接続名・タグドット。
7. 「← 接続一覧」で Home に戻る。
確認後 Ctrl+C。

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/workspace/WorkspaceShell.tsx src/renderer/src/workspace/WorkspaceShell.module.css
git commit -m "feat: WorkspaceShell を組み立て、通しで動作確認"
```

---

## Phase 6: 仕上げ・最終検証

### Task 22: 全テスト・型チェック・ビルド ＋ 接続エラー表示

**Files:**
- Modify: `src/renderer/src/home/HomeScreen.tsx`（接続エラー表示を追加）

- [ ] **Step 1: 接続失敗時のエラーを Home に表示**

`src/renderer/src/home/HomeScreen.tsx` の `ConnectionList` の下（`{formOpen && ...}` の上）に、`connectError` を表示する帯を追加する。まず import 済みの `useAppStore` から取得:

`HomeScreen` 関数内の hooks に追加:

```tsx
  const connectError = useAppStore((s) => s.connectError)
```

`<ConnectionList />` の直後に追加:

```tsx
        {connectError && (
          <div className={styles.connError}>
            接続失敗 — <b>{connectError.code}</b>: {connectError.message}
          </div>
        )}
```

`src/renderer/src/home/HomeScreen.module.css` に追加:

```css
.connError {
  margin: 0 16px 12px;
  padding: 8px 12px;
  background: #fff0f0;
  border: 1px solid #ffd5d5;
  border-radius: var(--radius);
  color: #b91c1c;
  font-size: 12px;
}
```

- [ ] **Step 2: 全ユニットテスト**

Run: `npx vitest run`
Expected: PASS（`ProfileStore` / `extractTableNames` / `helpers` のテストが緑。integration は DB 無しなら skipped）

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: 本番ビルド**

Run: `npm run build`
Expected: `out/` にメイン・preload・レンダラがビルドされ、エラーなく完了。

- [ ] **Step 5: 最終目視チェックリスト（要ローカル MySQL）**

Run: `npm run dev` で以下を確認:
- [ ] Home: 接続の新規作成・保存・編集・削除・検索が動く
- [ ] 接続失敗時に Home に赤帯エラーが出る
- [ ] Workspace: テーブル一覧表示、テーブルクリックで SELECT 実行
- [ ] ⌘↵ 実行、タブ追加/閉じ、結果グリッド、ステータスバー
- [ ] 「← 接続一覧」で往復できる
- [ ] インラインstyle が UI から消えている（全て CSS Modules/トークン）

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/home/HomeScreen.tsx src/renderer/src/home/HomeScreen.module.css
git commit -m "feat: 接続失敗エラーの表示を追加し、通し検証を完了"
```

---

## 完了の定義（Done）

- [ ] Home（保存済み接続リスト）↔ Workspace（サイドバー＋タブ＋CodeMirror＋結果グリッド）が Native Light で動作。
- [ ] 接続の保存・編集・削除・検索ができ、パスワードは `safeStorage` で暗号化保存される。
- [ ] サイドバーに実データのテーブル一覧、クリックで SELECT 実行。
- [ ] CodeMirror で SQL ハイライト＋⌘↵ 実行、結果は TanStack Table 表示。
- [ ] インラインstyle 全廃（`theme.css` ＋ CSS Modules）。
- [ ] `npx vitest run` / `npm run typecheck` / `npm run build` がすべて成功。

## 本スライスで意図的に未対応（後続）

SSH/SSL、セル編集・コミット、フィルタ、エクスポート、結果の仮想スクロール、クエリ履歴、タブ復元、ダークテーマ、フレームレス独自タイトルバー、CodeMirror のカスタム Native Light テーマ（本スライスは既定 `light` テーマを使用）。
