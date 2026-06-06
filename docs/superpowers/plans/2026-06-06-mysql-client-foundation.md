# MySQL クライアント — Plan 1: Foundation 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Electron + React + TypeScript で「MySQL に接続して任意の SQL を実行し、結果を表に表示できる」最小の Mac アプリ（walking skeleton）を作る。

**Architecture:** Electron のセキュアな2プロセス構成。メインプロセス(Node.js)が `mysql2` で DB 接続/クエリ実行を担い、レンダラ(React)は `contextIsolation` 下で preload が公開する型付き `window.api` 経由でのみメインに依頼する。DB 認証情報やクエリ実行はすべてメイン側に閉じ込める。

**Tech Stack:** Electron 31 / electron-vite 2 / Vite 5 / React 18 / TypeScript 5.5 / mysql2 3 / Vitest 2

> 関連設計書: `docs/superpowers/specs/2026-06-06-mysql-client-design.md`
> バージョンは「これに準拠、なければ最新の互換版」で可。

---

## File Structure（このプランで作成するファイル）

```
package.json                                  # 依存とスクリプト
electron.vite.config.ts                       # electron-vite 設定 (main/preload/renderer)
vitest.config.ts                              # Vitest 設定
tsconfig.json / tsconfig.node.json / tsconfig.web.json
docker-compose.test.yml                       # 結合テスト用 MySQL
src/shared/types.ts                           # main/preload/renderer 共有の型
src/main/index.ts                             # メインプロセス入口 (BrowserWindow + IPC登録)
src/main/connection/validateConnectionConfig.ts
src/main/connection/normalizeDbError.ts
src/main/connection/ConnectionManager.ts      # mysql2 プール管理・クエリ実行
src/main/ipc/registerDbHandlers.ts            # IPC ハンドラ (db:connect/query/disconnect)
src/preload/index.ts                          # contextBridge で window.api 公開
src/renderer/index.html
src/renderer/src/main.tsx                      # React 入口
src/renderer/src/App.tsx                       # 最小UI: 接続フォーム + SQL実行 + 結果表
src/renderer/src/env.d.ts                      # window.api の型宣言
```

責務境界: 「接続設定の検証」「エラー整形」「接続/クエリ実行」「IPC 配線」「UI」を別ファイルに分離し、各ファイル1責務を保つ。

---

## Task 1: プロジェクト雛形（Electron が起動する空ウィンドウ）

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`

- [ ] **Step 1: `package.json` を作成**

```json
{
  "name": "tableplus",
  "version": "0.1.0",
  "description": "タブ無制限の MySQL クライアント (Mac アプリ)",
  "main": "./out/main/index.js",
  "author": "spyder1211",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "mysql2": "^3.11.0"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "vite": "^5.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.0",
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: `electron.vite.config.ts` を作成**

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
```

- [ ] **Step 3: tsconfig 3 ファイルを作成**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"],
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "electron-vite/node"]
  }
}
```

`tsconfig.web.json`:
```json
{
  "include": ["src/renderer/src/**/*", "src/renderer/src/env.d.ts", "src/shared/**/*"],
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 4: メインプロセス入口 `src/main/index.ts` を作成**

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 5: 仮 preload `src/preload/index.ts` を作成**（Task 6 で拡張）

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

- [ ] **Step 6: レンダラの3ファイルを作成**

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>MySQL Client</title>
    <!-- CSP は dev の Vite HMR と衝突するため Plan 5 のハードニングで本番向けに追加する -->
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`（Task 7 で置き換え）:
```tsx
export default function App(): JSX.Element {
  return <h1>MySQL Client — 起動確認OK</h1>
}
```

`src/renderer/src/env.d.ts`（Task 6 で型を追加）:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 7: 依存をインストール**

Run: `npm install`
Expected: `node_modules/` が生成され、エラーなく完了。

- [ ] **Step 8: 起動確認**

Run: `npm run dev`
Expected: Electron ウィンドウが開き、「MySQL Client — 起動確認OK」と表示される。確認後 `Ctrl+C` で終了。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Electron+React+TS の雛形を追加 (空ウィンドウ起動)"
```

---

## Task 2: 共有型の定義

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: 共有型を作成**

```ts
// main / preload / renderer すべてで共有する型
export interface ConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database?: string
}

export interface QueryColumn {
  name: string
}

export interface QueryResult {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
}

export interface AppError {
  code: string
  message: string
}

// IPC の戻り値は例外を投げず、必ずこの判別共用体で返す
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: main/preload/renderer 共有の型を追加"
```

---

## Task 3: 接続設定のバリデーション（純粋関数・TDD）

**Files:**
- Create: `src/main/connection/validateConnectionConfig.ts`
- Test: `src/main/connection/validateConnectionConfig.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/main/connection/validateConnectionConfig.test.ts
import { describe, it, expect } from 'vitest'
import { validateConnectionConfig } from './validateConnectionConfig'

describe('validateConnectionConfig', () => {
  it('正しい設定ではエラー0件', () => {
    expect(
      validateConnectionConfig({ host: 'localhost', port: 3306, user: 'root', password: '' })
    ).toEqual([])
  })

  it('host 欠落を検出', () => {
    expect(validateConnectionConfig({ port: 3306, user: 'root' })).toContain('host は必須です')
  })

  it('port が範囲外なら検出', () => {
    expect(validateConnectionConfig({ host: 'h', port: 0, user: 'u' })).toContain(
      'port は 1〜65535 の範囲で指定してください'
    )
  })

  it('user 欠落を検出', () => {
    expect(validateConnectionConfig({ host: 'h', port: 3306 })).toContain('user は必須です')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/validateConnectionConfig.test.ts`
Expected: FAIL（`validateConnectionConfig` が未定義）。

- [ ] **Step 3: 最小実装を書く**

```ts
// src/main/connection/validateConnectionConfig.ts
import type { ConnectionConfig } from '../../shared/types'

export function validateConnectionConfig(config: Partial<ConnectionConfig>): string[] {
  const errors: string[] = []
  if (!config.host) errors.push('host は必須です')
  if (config.port === undefined || config.port < 1 || config.port > 65535) {
    errors.push('port は 1〜65535 の範囲で指定してください')
  }
  if (!config.user) errors.push('user は必須です')
  return errors
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/connection/validateConnectionConfig.test.ts`
Expected: PASS（4件）。

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/validateConnectionConfig.ts src/main/connection/validateConnectionConfig.test.ts
git commit -m "feat: 接続設定バリデーションを追加 (TDD)"
```

---

## Task 4: DB エラーの整形（純粋関数・TDD）

**Files:**
- Create: `src/main/connection/normalizeDbError.ts`
- Test: `src/main/connection/normalizeDbError.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/main/connection/normalizeDbError.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeDbError } from './normalizeDbError'

describe('normalizeDbError', () => {
  it('mysql2 のエラー(code + sqlMessage)を整形', () => {
    const err = { code: 'ER_ACCESS_DENIED_ERROR', sqlMessage: "Access denied for user 'root'" }
    expect(normalizeDbError(err)).toEqual({
      code: 'ER_ACCESS_DENIED_ERROR',
      message: "Access denied for user 'root'"
    })
  })

  it('通常の Error は message を使い code は UNKNOWN', () => {
    expect(normalizeDbError(new Error('boom'))).toEqual({ code: 'UNKNOWN', message: 'boom' })
  })

  it('未知の値は文字列化', () => {
    expect(normalizeDbError('x')).toEqual({ code: 'UNKNOWN', message: 'x' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/normalizeDbError.test.ts`
Expected: FAIL（未定義）。

- [ ] **Step 3: 最小実装を書く**

```ts
// src/main/connection/normalizeDbError.ts
import type { AppError } from '../../shared/types'

export function normalizeDbError(err: unknown): AppError {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string; sqlMessage?: string }
    return {
      code: e.code ?? 'UNKNOWN',
      message: e.sqlMessage ?? e.message ?? 'Unknown database error'
    }
  }
  return { code: 'UNKNOWN', message: String(err) }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/connection/normalizeDbError.test.ts`
Expected: PASS（3件）。

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/normalizeDbError.ts src/main/connection/normalizeDbError.test.ts
git commit -m "feat: DB エラー整形ユーティリティを追加 (TDD)"
```

---

## Task 5: ConnectionManager（mysql2 接続・クエリ実行・結合テスト）

**Files:**
- Create: `src/main/connection/ConnectionManager.ts`
- Create: `vitest.config.ts`, `docker-compose.test.yml`
- Test: `src/main/connection/ConnectionManager.integration.test.ts`

- [ ] **Step 1: Vitest 設定を作成**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts']
  }
})
```

- [ ] **Step 2: 結合テスト用 MySQL の compose を作成**

```yaml
# docker-compose.test.yml
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpw
      MYSQL_DATABASE: testdb
    ports:
      - "13306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-prootpw"]
      interval: 3s
      timeout: 5s
      retries: 20
```

- [ ] **Step 3: 失敗する結合テストを書く**

```ts
// src/main/connection/ConnectionManager.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ConnectionManager } from './ConnectionManager'

const hasDb = !!process.env.TEST_MYSQL_HOST
const cfg = {
  host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_MYSQL_PORT ?? 13306),
  user: process.env.TEST_MYSQL_USER ?? 'root',
  password: process.env.TEST_MYSQL_PASSWORD ?? 'rootpw',
  database: process.env.TEST_MYSQL_DATABASE ?? 'testdb'
}

describe.skipIf(!hasDb)('ConnectionManager (integration)', () => {
  const mgr = new ConnectionManager()
  beforeAll(async () => { await mgr.connect(cfg) })
  afterAll(async () => { await mgr.disconnect() })

  it('SELECT 1 が実行でき、行と列が返る', async () => {
    const res = await mgr.query('SELECT 1 AS one')
    expect(res.rows[0]).toEqual({ one: 1 })
    expect(res.columns.map((c) => c.name)).toContain('one')
    expect(res.rowCount).toBe(1)
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('不正な SQL は例外を投げる', async () => {
    await expect(mgr.query('SELECT * FROM no_such_table')).rejects.toMatchObject({
      code: 'ER_NO_SUCH_TABLE'
    })
  })
})
```

- [ ] **Step 4: テスト用 MySQL を起動し、テストが失敗することを確認**

```bash
docker compose -f docker-compose.test.yml up -d
# healthy になるまで待つ (10〜20秒)
TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts
```
Expected: FAIL（`ConnectionManager` が未定義）。

- [ ] **Step 5: ConnectionManager を実装**

```ts
// src/main/connection/ConnectionManager.ts
import mysql from 'mysql2/promise'
import type { ConnectionConfig, QueryResult } from '../../shared/types'

export class ConnectionManager {
  private pool: mysql.Pool | null = null

  async connect(config: ConnectionConfig): Promise<void> {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5
    })
    // 実際に1本取得して疎通を確認（認証エラー等をここで顕在化）
    const conn = await this.pool.getConnection()
    conn.release()
  }

  async query(sql: string): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const start = Date.now()
    const [rows, fields] = await this.pool.query(sql)
    const durationMs = Date.now() - start
    const dataRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    const columns = (fields ?? []).map((f) => ({ name: (f as { name: string }).name }))
    return { columns, rows: dataRows, rowCount: dataRows.length, durationMs }
  }

  isConnected(): boolean {
    return this.pool !== null
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts`
Expected: PASS（2件）。確認後 `docker compose -f docker-compose.test.yml down` で停止可。

- [ ] **Step 7: 単体テストも含め全テストが通ることを確認**

Run: `npm test`
Expected: Task 3/4 の単体は PASS。結合テストは `TEST_MYSQL_HOST` 未設定なら skip される。

- [ ] **Step 8: `.gitignore` を確認**（既存に `node_modules/`, `out/`, `dist/` がある前提。無ければ追記）

- [ ] **Step 9: Commit**

```bash
git add src/main/connection/ConnectionManager.ts src/main/connection/ConnectionManager.integration.test.ts vitest.config.ts docker-compose.test.yml
git commit -m "feat: ConnectionManager (接続/クエリ実行) を追加 (TDD/結合)"
```

---

## Task 6: IPC ハンドラと preload ブリッジの配線

**Files:**
- Create: `src/main/ipc/registerDbHandlers.ts`
- Modify: `src/main/index.ts`（ハンドラ登録）
- Modify: `src/preload/index.ts`（型付き API 公開）
- Modify: `src/renderer/src/env.d.ts`（`window.api` の型）

- [ ] **Step 1: IPC ハンドラを作成**

```ts
// src/main/ipc/registerDbHandlers.ts
import { ipcMain } from 'electron'
import { ConnectionManager } from '../connection/ConnectionManager'
import { validateConnectionConfig } from '../connection/validateConnectionConfig'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ConnectionConfig, ApiResult, QueryResult } from '../../shared/types'

export function registerDbHandlers(manager: ConnectionManager): void {
  ipcMain.handle(
    'db:connect',
    async (_e, config: ConnectionConfig): Promise<ApiResult<null>> => {
      const errors = validateConnectionConfig(config)
      if (errors.length > 0) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: errors.join(', ') } }
      }
      try {
        await manager.connect(config)
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('db:query', async (_e, sql: string): Promise<ApiResult<QueryResult>> => {
    try {
      return { ok: true, data: await manager.query(sql) }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('db:disconnect', async (): Promise<ApiResult<null>> => {
    try {
      await manager.disconnect()
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
}
```

- [ ] **Step 2: `src/main/index.ts` でハンドラを登録**

`import { app, BrowserWindow } from 'electron'` の下に追記:
```ts
import { ConnectionManager } from './connection/ConnectionManager'
import { registerDbHandlers } from './ipc/registerDbHandlers'
```

`app.whenReady().then(() => {` の直後（`createWindow()` の前）に追記:
```ts
  registerDbHandlers(new ConnectionManager())
```

- [ ] **Step 3: preload で型付き API を公開**

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionConfig, ApiResult, QueryResult } from '../shared/types'

const api = {
  connect: (config: ConnectionConfig): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:connect', config),
  query: (sql: string): Promise<ApiResult<QueryResult>> => ipcRenderer.invoke('db:query', sql),
  disconnect: (): Promise<ApiResult<null>> => ipcRenderer.invoke('db:disconnect')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
```

- [ ] **Step 4: レンダラに `window.api` の型を宣言**

```ts
// src/renderer/src/env.d.ts
/// <reference types="vite/client" />
import type { ConnectionConfig, ApiResult, QueryResult } from '../../shared/types'

declare global {
  interface Window {
    api: {
      connect: (config: ConnectionConfig) => Promise<ApiResult<null>>
      query: (sql: string) => Promise<ApiResult<QueryResult>>
      disconnect: () => Promise<ApiResult<null>>
    }
  }
}
```

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/registerDbHandlers.ts src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: DB 操作の IPC ハンドラと preload ブリッジを配線"
```

---

## Task 7: 最小 UI（接続フォーム + SQL 実行 + 結果表）

**Files:**
- Modify: `src/renderer/src/App.tsx`（全置換）

- [ ] **Step 1: `src/renderer/src/App.tsx` を以下で全置換**

```tsx
import { useState } from 'react'
import type { ConnectionConfig, QueryResult, AppError } from '../../shared/types'

export default function App(): JSX.Element {
  const [config, setConfig] = useState<ConnectionConfig>({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: ''
  })
  const [connected, setConnected] = useState(false)
  const [sql, setSql] = useState('SELECT 1 AS one')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<AppError | null>(null)

  async function handleConnect(): Promise<void> {
    setError(null)
    const res = await window.api.connect(config)
    if (res.ok) setConnected(true)
    else setError(res.error)
  }

  async function handleRun(): Promise<void> {
    setError(null)
    const res = await window.api.query(sql)
    if (res.ok) setResult(res.data)
    else setError(res.error)
  }

  const set = (k: keyof ConnectionConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setConfig({ ...config, [k]: k === 'port' ? Number(e.target.value) : e.target.value })

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h2>MySQL Client (Foundation)</h2>

      <fieldset style={{ marginBottom: 12 }}>
        <legend>接続</legend>
        <input placeholder="host" value={config.host} onChange={set('host')} />
        <input placeholder="port" type="number" value={config.port} onChange={set('port')} style={{ width: 80 }} />
        <input placeholder="user" value={config.user} onChange={set('user')} />
        <input placeholder="password" type="password" value={config.password} onChange={set('password')} />
        <input placeholder="database" value={config.database ?? ''} onChange={set('database')} />
        <button onClick={handleConnect}>接続</button>
        <span style={{ marginLeft: 8 }}>{connected ? '🟢 接続済み' : '⚪ 未接続'}</span>
      </fieldset>

      <div style={{ marginBottom: 12 }}>
        <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={4} style={{ width: '100%', fontFamily: 'monospace' }} />
        <button onClick={handleRun} disabled={!connected}>実行</button>
      </div>

      {error && (
        <div style={{ color: '#b91c1c', marginBottom: 12 }}>
          <b>{error.code}</b>: {error.message}
        </div>
      )}

      {result && (
        <div>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>
            {result.rowCount} 行 · {result.durationMs}ms
          </div>
          <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>{result.columns.map((c) => <th key={c.name}>{c.name}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i}>
                  {result.columns.map((c) => (
                    <td key={c.name}>{row[c.name] === null ? <i>NULL</i> : String(row[c.name])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: 接続フォーム+SQL実行+結果表の最小UIを追加"
```

---

## Task 8: 手動 E2E 検証

- [ ] **Step 1: ローカル MySQL を用意**（テスト用 compose を流用可）

```bash
docker compose -f docker-compose.test.yml up -d
```
（または既存のローカル MySQL を使用。host/port/user/password を控える）

- [ ] **Step 2: アプリを起動**

Run: `npm run dev`
Expected: ウィンドウが開き「MySQL Client (Foundation)」が表示される。

- [ ] **Step 3: 接続して確認**

1. 接続欄に host=`127.0.0.1` port=`13306` user=`root` password=`rootpw` database=`testdb` を入力 →「接続」
   Expected: 「🟢 接続済み」に変わる。
2. SQL 欄に `SELECT 1 AS one;` →「実行」
   Expected: `one / 1` の表が表示され、行数と実行時間が出る。
3. SQL 欄に `SELECT * FROM no_such_table;` →「実行」
   Expected: 赤字で `ER_NO_SUCH_TABLE: ...` が表示される（アプリは落ちない）。
4. （任意）誤った password で「接続」
   Expected: 赤字で `ER_ACCESS_DENIED_ERROR: ...`、🟢 にならない。

- [ ] **Step 4: 後片付け**

```bash
docker compose -f docker-compose.test.yml down
```

- [ ] **Step 5: マイルストーン Commit（任意）**

```bash
git commit --allow-empty -m "chore: Plan 1 (Foundation) 完了 — 接続してクエリが流せる walking skeleton"
```

---

## Verification（このプラン全体の完了条件）

- `npm run dev` でウィンドウが起動する。
- `npm test`（単体）が緑。結合テストは MySQL 起動時に緑、未起動時は skip。
- `npm run typecheck` がエラーなし。
- 手動 E2E（Task 8）: 接続 → `SELECT` 実行 → 結果表表示 → 不正 SQL/認証エラーが UI に表示されアプリが落ちない、まで確認できる。
- セキュリティ: `contextIsolation: true` / `nodeIntegration: false`、レンダラは `window.api` 経由のみで DB に触れる。

## Self-Review メモ（spec カバレッジ）

このプランがカバーする spec 要件: §5 プロセスモデル（セキュア IPC）、§5 `ConnectionManager`/`QueryService` の中核、§9 技術スタックの土台。
**後続プランへ**: 接続プロファイル保存/Keychain/色ラベル（Plan 5/接続管理拡張）、スキーマツリー・グリッド・無制限タブ・フィルタ（Plan 2）、セル編集・ステージング・コミット（Plan 3）、CodeMirror・補完・実行モード・複数結果（Plan 4）、SSH/SSL・エクスポート/インポート・安全機能・接続共有（Plan 5）。

---

## 後続プラン ロードマップ（各マイルストーン完了時に bite-sized 化）

- **Plan 2 — データ閲覧:** 接続プロファイル保存(JSON)、スキーマツリー(SchemaService)、無制限タブ基盤(Zustand ストア)、仮想スクロールグリッド(TanStack Table+Virtual)、カラム別複数フィルタ(FilterBuilder → パラメータ化 WHERE)。
- **Plan 3 — セル編集:** 型別セルエディタ、編集ステージング、主キーによる UPDATE/INSERT/DELETE 生成、変更 SQL プレビュー、トランザクションコミット、主キー無しテーブルのフォールバック。
- **Plan 4 — SQL エディタ強化:** CodeMirror 6 統合、スキーマ連動オートコンプリート、カーソル位置/選択/全実行、複数結果タブ、クエリ履歴。
- **Plan 5 — 拡張:** SSH トンネル(ssh2)/SSL、CSV/JSON/SQL エクスポート(フィルタ＆ソート連動)・インポート、読み取り専用モード/本番保護/色ラベル、パスワード Keychain(keytar)、接続設定のエクスポート/インポート共有、electron-builder で `.dmg` パッケージング。
