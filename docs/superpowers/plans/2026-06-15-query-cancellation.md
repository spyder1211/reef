# クエリキャンセル（U1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実行中の SQL タブ／テーブル閲覧クエリを「停止」ボタンから別接続の `KILL QUERY` で中断し、中断を既存の CANCELLED 経路で静かに止める。

**Architecture:** main で「キャンセル可能クエリ」を pool の専用接続上で実行し、その `threadId` を `tabId` キーで `runningQueries` Map に登録。`cancel(tabId)` は別接続から `KILL QUERY <threadId>` を送る。中断された文の `ER_QUERY_INTERRUPTED`(1317) を `QueryCancelledError` に変換し、IPC ハンドラが既存 `CANCELLED` を返す。renderer は既存 `isCancelled` で running を解除。停止ボタンは結果ペインの「実行中…」横に出す。

**Tech Stack:** Electron / mysql2 (Pool/PoolConnection) / Zustand / React / vitest（main=node 統合テスト、renderer store=node ユニット）。

**Spec:** `docs/superpowers/specs/2026-06-15-query-cancellation-design.md`

**前提:** ブランチ `feat/query-cancellation`（spec コミット済み `2a256cf`）。統合テストは MySQL が必要 → 実行前に `docker compose -f docker-compose.test.yml up -d` し、`TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD=rootpw TEST_MYSQL_DATABASE=testdb` を付けて実行する。既存コードは `throw new Error('Not connected')`（英語）で統一されているので踏襲する。

---

## Task 1: キャンセル判定モジュール（純粋・ユニット TDD）

`QueryCancelledError` と「mysql2 のクエリ中断エラーか」を判定する純関数を独立モジュールに切り出す（単一責任・ユニットテスト可能化）。

**Files:**
- Create: `src/main/connection/queryCancellation.ts`
- Test: `src/main/connection/queryCancellation.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/connection/queryCancellation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { QueryCancelledError, isQueryInterrupted } from './queryCancellation'

describe('queryCancellation', () => {
  it('code が ER_QUERY_INTERRUPTED なら中断とみなす', () => {
    expect(isQueryInterrupted({ code: 'ER_QUERY_INTERRUPTED' })).toBe(true)
  })
  it('errno が 1317 なら中断とみなす', () => {
    expect(isQueryInterrupted({ errno: 1317 })).toBe(true)
  })
  it('別のエラーは中断とみなさない', () => {
    expect(isQueryInterrupted({ code: 'ER_PARSE_ERROR', errno: 1064 })).toBe(false)
    expect(isQueryInterrupted(null)).toBe(false)
    expect(isQueryInterrupted(undefined)).toBe(false)
    expect(isQueryInterrupted(new Error('x'))).toBe(false)
  })
  it('QueryCancelledError は Error の派生で name が付く', () => {
    const e = new QueryCancelledError()
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('QueryCancelledError')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/queryCancellation.test.ts`
Expected: FAIL（`queryCancellation` モジュールが存在しない）

- [ ] **Step 3: 実装する**

`src/main/connection/queryCancellation.ts`:
```ts
// 実行中クエリが KILL QUERY で中断された時に投げる番兵エラー。
// IPC 層がこれを検出して既存の CANCELLED（静かな中止）へ翻訳する。
export class QueryCancelledError extends Error {
  constructor() {
    super('Query cancelled')
    this.name = 'QueryCancelledError'
  }
}

// mysql2 の「クエリ実行が中断された」エラー（KILL QUERY 由来）か判定する。
// code='ER_QUERY_INTERRUPTED' / errno=1317 のどちらかで判定。
export function isQueryInterrupted(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; errno?: unknown }
  return e.code === 'ER_QUERY_INTERRUPTED' || e.errno === 1317
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/connection/queryCancellation.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/main/connection/queryCancellation.ts src/main/connection/queryCancellation.test.ts
git commit -m "feat(cancel): クエリ中断判定モジュールを追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ConnectionManager に runningQueries / runCancellable / cancel を追加（統合 TDD）

`query`/`queryScript` に任意の `tabId` を足し、tabId ありなら専用接続で実行＋登録。`cancel(tabId)` で別接続から `KILL QUERY`。結果整形と文ループは execer（Pool または PoolConnection）を受ける共通ヘルパーへ DRY 化する。

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`
- Test: `src/main/connection/ConnectionManager.integration.test.ts`（末尾の `describe` 内に追記）

- [ ] **Step 1: 失敗する統合テストを書く**

`src/main/connection/ConnectionManager.integration.test.ts` の `describe.skipIf(!hasDb)('ConnectionManager (integration)', () => { ... })` ブロックの**末尾**（`afterAll` と同じ階層、最後の `it` の後ろ）に追記:
```ts
  it('cancel: 実行中クエリを速やかに中断し、接続は再利用できる', async () => {
    const started = Date.now()
    const p = mgr.query('SELECT SLEEP(10) AS s', [], 'cancel-1')
    // クエリがサーバに届き runningQueries に登録されるまで少し待つ
    await new Promise((r) => setTimeout(r, 500))
    await mgr.cancel('cancel-1')
    // 中断されるので 10 秒待たずに settle する（SLEEP は 1 を返す/重い文は 1317 で reject、どちらも可）
    await p.catch(() => undefined)
    expect(Date.now() - started).toBeLessThan(5000)
    // KILL QUERY は接続を殺さないので後続クエリが通る
    const r = await mgr.query('SELECT 1 AS one', [], 'cancel-2')
    expect(Number(r.rows[0]?.one)).toBe(1)
  }, 15000)

  it('cancel: 実行中でない tabId は no-op（reject しない）', async () => {
    await expect(mgr.cancel('no-such-tab')).resolves.toBeUndefined()
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD=rootpw TEST_MYSQL_DATABASE=testdb \
  npx vitest run src/main/connection/ConnectionManager.integration.test.ts
```
Expected: FAIL（`mgr.cancel` が存在しない / `query` が3引数を受けない型エラー）

- [ ] **Step 3: ConnectionManager を実装する**

`src/main/connection/ConnectionManager.ts`:

(a) import に追加（1行目付近の import 群へ）:
```ts
import { QueryCancelledError, isQueryInterrupted } from './queryCancellation'
```

(b) フィールド追加（`private pool: mysql.Pool | null = null` の直後）:
```ts
  // tabId → 実行中クエリの MySQL スレッドID。cancel() の KILL QUERY 対象を引くため。
  private runningQueries = new Map<string, number>()
```

(c) 既存の `query`（行28-39）を次で置き換える:
```ts
  async query(sql: string, params?: unknown[], tabId?: string): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    if (tabId) return this.runCancellable(tabId, (conn) => this.runOne(conn, sql, params))
    return this.runOne(this.pool, sql, params)
  }

  // execer（Pool でも PoolConnection でも可）で1文実行し QueryResult へ整形する。
  private async runOne(
    execer: mysql.Pool | mysql.PoolConnection,
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    const start = Date.now()
    const [rows, fields] = await execer.query(sql, params)
    const durationMs = Date.now() - start
    const dataRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    const columns = (fields ?? []).map((f) => {
      const ff = f as { name: string; type?: number }
      return { name: ff.name, type: typeof ff.type === 'number' ? fieldTypeName(ff.type) : undefined }
    })
    return { columns, rows: dataRows, rowCount: dataRows.length, durationMs }
  }

  // tabId 付きクエリを pool の専用接続で実行し、threadId を登録する。
  // 中断（KILL QUERY）された文は QueryCancelledError に翻訳する。
  // KILL QUERY は接続を殺さないので finally は release（destroy ではない）。
  private async runCancellable<T>(
    tabId: string,
    fn: (conn: mysql.PoolConnection) => Promise<T>
  ): Promise<T> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    let threadId = conn.threadId
    if (threadId == null) {
      const [rows] = await conn.query('SELECT CONNECTION_ID() AS id')
      threadId = Number((rows as Array<{ id: number }>)[0]?.id)
    }
    this.runningQueries.set(tabId, threadId)
    try {
      return await fn(conn)
    } catch (err) {
      if (isQueryInterrupted(err)) throw new QueryCancelledError()
      throw err
    } finally {
      this.runningQueries.delete(tabId)
      conn.release()
    }
  }

  // 実行中クエリを別接続から KILL QUERY で中断する。実行中でなければ no-op。
  async cancel(tabId: string): Promise<void> {
    const threadId = this.runningQueries.get(tabId)
    if (threadId == null || !this.pool) return
    await this.pool.query('KILL QUERY ?', [threadId])
  }
```

(d) 既存の `queryScript`（行46-58）を次で置き換える:
```ts
  async queryScript(sql: string, tabId?: string): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const splitter = new SqlStatementSplitter()
    const statements = [...splitter.push(sql), ...splitter.end()]
    if (statements.length === 0) return { columns: [], rows: [], rowCount: 0, durationMs: 0 }
    if (tabId) return this.runCancellable(tabId, (conn) => this.runScript(conn, statements))
    return this.runScript(this.pool, statements)
  }

  // 分割済みの文を execer 上で順次実行し、最後の文の結果＋全体所要時間を返す。
  // 途中で中断 reject が起きたら呼び出し元（runCancellable）へ伝播し残り文は実行しない。
  private async runScript(
    execer: mysql.Pool | mysql.PoolConnection,
    statements: string[]
  ): Promise<QueryResult> {
    const start = Date.now()
    let last: QueryResult = { columns: [], rows: [], rowCount: 0, durationMs: 0 }
    for (const stmt of statements) {
      last = await this.runOne(execer, stmt)
    }
    return { ...last, durationMs: Date.now() - start }
  }
```

> 注: `listTables` 等の内部呼び出しは `this.query('SHOW TABLES')`（tabId 無し）のままで、従来どおり非キャンセル対象。`mysql.PoolConnection` 型は `import mysql from 'mysql2/promise'` の `mysql` 名前空間から参照できる（既存 import を流用）。

- [ ] **Step 4: テストが通ることを確認**

Run:
```bash
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD=rootpw TEST_MYSQL_DATABASE=testdb \
  npx vitest run src/main/connection/ConnectionManager.integration.test.ts
```
Expected: PASS（既存 + 追加2件すべて green）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/main/connection/ConnectionManager.ts src/main/connection/ConnectionManager.integration.test.ts
git commit -m "feat(cancel): ConnectionManager に専用接続実行と KILL QUERY を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: IPC ハンドラに tabId 受け渡しと db:cancel を追加

`db:query`/`db:queryScript` に tabId を流し、`QueryCancelledError` を既存 `CANCELLED` へ翻訳。新規 `db:cancel` を追加（本番ガードなし）。

**Files:**
- Modify: `src/main/ipc/registerDbHandlers.ts`

- [ ] **Step 1: import に QueryCancelledError を追加**

`src/main/ipc/registerDbHandlers.ts` の import 群（`normalizeDbError` の近く）へ:
```ts
import { QueryCancelledError } from '../connection/queryCancellation'
```

- [ ] **Step 2: db:query ハンドラを置き換える（行43-53）**

```ts
  ipcMain.handle(
    'db:query',
    async (e, tabId: string, sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      try {
        return { ok: true, data: await manager.query(sql, params, tabId) }
      } catch (err) {
        if (err instanceof QueryCancelledError) return CANCELLED
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )
```

- [ ] **Step 3: db:queryScript ハンドラを置き換える（行55-70）**

```ts
  ipcMain.handle(
    'db:queryScript',
    async (e, tabId: string, sql: string): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      // キャンセル（実行前ガード／実行中 KILL）は履歴に残さない。成功/失敗時のみ history.add。
      try {
        const data = await manager.queryScript(sql, tabId)
        history.add({ sql, durationMs: data.durationMs, ok: true })
        return { ok: true, data }
      } catch (err) {
        if (err instanceof QueryCancelledError) return CANCELLED
        const error = normalizeDbError(err)
        history.add({ sql, durationMs: 0, ok: false, errorMessage: error.message })
        return { ok: false, error }
      }
    }
  )
```

- [ ] **Step 4: db:cancel ハンドラを追加（db:queryScript ハンドラの直後）**

```ts
  // 実行中クエリの停止。自分のクエリの KILL QUERY は破壊的でないので本番ガードは通さない。
  ipcMain.handle('db:cancel', async (_e, tabId: string): Promise<ApiResult<null>> => {
    try {
      await manager.cancel(tabId)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
```

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし（preload 側は次タスクで合わせるため、ここでは main プロジェクトの型が通ればよい。`npm run typecheck` が web 側で `query` 引数不一致を出す場合は Task 4 まで続けて解消する）

> 補足: `typecheck` は node/web 両方を走らせる。renderer の呼び出し更新（Task 5）と型定義（Task 4）が未了だと web 側でエラーが残る。Task 3 単独コミットの段階では **node プロジェクトの型が通ること**を確認し、web のエラーは Task 4・5 完了後の Task 6 で解消する。

- [ ] **Step 6: コミット**

```bash
git add src/main/ipc/registerDbHandlers.ts
git commit -m "feat(cancel): IPC に tabId 受け渡しと db:cancel を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: preload と型定義に tabId 引数・cancelQuery を追加

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: preload の query/queryScript を更新し cancelQuery を追加**

`src/preload/index.ts` の `query`/`queryScript`（行21-25）を置き換え:
```ts
  query: (tabId: string, sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:query', tabId, sql, params),
  // SQL エディタ用：複数文を ; で分割して順に実行（main 側）。
  queryScript: (tabId: string, sql: string): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:queryScript', tabId, sql),
  // 実行中クエリを停止（KILL QUERY）。
  cancelQuery: (tabId: string): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:cancel', tabId),
```

- [ ] **Step 2: env.d.ts の Window.api 型を合わせる**

`src/renderer/src/env.d.ts` の該当行（25-26）を置き換え:
```ts
      query: (tabId: string, sql: string, params?: unknown[]) => Promise<ApiResult<QueryResult>>
      queryScript: (tabId: string, sql: string) => Promise<ApiResult<QueryResult>>
      cancelQuery: (tabId: string) => Promise<ApiResult<null>>
```

- [ ] **Step 3: コミット**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat(cancel): preload に tabId 引数と cancelQuery を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: renderer ストア — canceling フラグ・tabId 受け渡し・cancelTab（ユニット TDD）

`BaseTab` に `canceling` を足し、`runSql`/`runTable` の IPC 呼び出しへ tabId を渡し（runTable に `isCancelled` 分岐を追加）、`cancelTab` アクションを追加する。

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`
- Test: `src/renderer/src/store/useAppStore.cancel.test.ts`（新規）

- [ ] **Step 1: 失敗するストアテストを書く**

`src/renderer/src/store/useAppStore.cancel.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'

function resetStore(): void {
  useAppStore.setState({
    tabs: [
      {
        kind: 'sql', id: 'tab-1', title: 'Q', sql: 'SELECT SLEEP(9)',
        result: null, error: null, running: true, canceling: false
      }
    ] as never,
    activeTabId: 'tab-1'
  })
}

describe('cancelTab', () => {
  beforeEach(resetStore)
  afterEach(() => vi.unstubAllGlobals())

  it('cancelQuery を tabId 付きで呼び、canceling を立てる', async () => {
    const cancelQuery = vi.fn(async () => ({ ok: true, data: null }))
    vi.stubGlobal('window', { api: { cancelQuery } })

    await useAppStore.getState().cancelTab('tab-1')

    expect(cancelQuery).toHaveBeenCalledWith('tab-1')
    const tab = useAppStore.getState().tabs.find((t) => t.id === 'tab-1')
    expect(tab?.canceling).toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/useAppStore.cancel.test.ts`
Expected: FAIL（`cancelTab` が無い / `canceling` 型エラー）

- [ ] **Step 3: BaseTab に canceling を追加（行30-35）**

```ts
interface BaseTab {
  id: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
  canceling: boolean // 停止要求送信中（停止ボタンの「停止中…」表示用）
}
```

- [ ] **Step 4: 初期化に canceling: false を追加**

`makeSqlTab`（行83-84 付近の `running: false` の行）を `running: false,` にして直後に `canceling: false` を追加:
```ts
    result: null,
    error: null,
    running: false,
    canceling: false
```
`makeTableTab`（行111-115 付近）の末尾、`running: true` の直後に `canceling: false` を追加:
```ts
    result: null,
    error: null,
    // 開いた直後は初回クエリ実行中とみなし、結果ペインのプレースホルダ点滅を防ぐ
    running: true,
    canceling: false
```

- [ ] **Step 5: setTabRunning と failTab で canceling をリセット**

`setTabRunning`（行207-209）を置き換え:
```ts
  function setTabRunning(tabId: string): void {
    set({
      tabs: get().tabs.map((t) =>
        t.id === tabId ? { ...t, running: true, canceling: false, error: null } : t
      )
    })
  }
```
`failTab`（行219-226）の更新オブジェクトに `canceling: false` を追加:
```ts
        t.id === tabId
          ? { ...t, running: false, canceling: false, result: null, error: { code: 'CLIENT_ERROR', message } }
          : t
```

- [ ] **Step 6: runSql に tabId を渡し、running 解除時に canceling も戻す（行237-263）**

`runSql` 内の2か所を更新:
- `const res = await window.api.queryScript(sql)` → `const res = await window.api.queryScript(tabId, sql)`
- isCancelled 分岐の `{ ...t, running: false }` → `{ ...t, running: false, canceling: false }`
- 成功時 set の更新オブジェクトに `canceling: false` を追加（`running: false,` の直後）

置き換え後の該当部分:
```ts
      const res = await window.api.queryScript(tabId, sql)
      if (isCancelled(res)) {
        set({
          tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: false, canceling: false } : t))
        })
        return
      }
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                running: false,
                canceling: false,
                result: res.ok ? res.data : null,
                error: res.ok ? null : res.error
              }
            : t
        )
      })
```

- [ ] **Step 7: runTable に tabId を渡し、isCancelled 分岐を追加（行265-299）**

`const res = await window.api.query(sql, params)` を `const res = await window.api.query(tabId, sql, params)` に変更。COUNT クエリ（`await window.api.query(c.sql, c.params)`）は tabId を渡さない（内部・非キャンセル対象のまま）。`const res` 取得直後に isCancelled 分岐を追加:
```ts
      const res = await window.api.query(tabId, sql, params)
      if (isCancelled(res)) {
        patchTableTab(tabId, (t) => ({ ...t, running: false, canceling: false }))
        return
      }
```
さらに最終 set の2つの戻り（`!res.ok` 側と成功側）に `canceling: false` を追加:
```ts
          if (!res.ok) return { ...t, running: false, canceling: false, result: null, error: res.error }
          const columns = t.columns.length > 0 ? t.columns : res.data.columns.map((col) => col.name)
          return { ...t, running: false, canceling: false, result: res.data, error: null, columns, total }
```

- [ ] **Step 8: AppState インターフェースに cancelTab を宣言（行161 runActiveTab の近く）**

`runActiveTab: () => Promise<void>` の直後に追加:
```ts
  cancelTab: (tabId: string) => Promise<void>
```

- [ ] **Step 9: cancelTab 実装を runTable の直後（行299 の後）に追加**

```ts
  // 実行中クエリの停止要求を送る。running の解除は、停止された query/queryScript が
  // CANCELLED で解決した時に runSql/runTable 側で行われる（ここでは canceling だけ立てる）。
  async function cancelTab(tabId: string): Promise<void> {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab || !tab.running || tab.canceling) return
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, canceling: true } : t)) })
    await window.api.cancelQuery(tabId)
  }
```

- [ ] **Step 10: 返却オブジェクトに cancelTab を公開**

`return { ... }` の中、`runActiveTab` を返している箇所の近く（アクションを列挙している領域）に `cancelTab,` を追加する。`runActiveTab` は内部で `runSql`/`runTable` を呼ぶラッパーとして定義・公開されているので、同じ列挙ブロックに `cancelTab` を足せばよい。

- [ ] **Step 11: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/useAppStore.cancel.test.ts`
Expected: PASS（1 test）

- [ ] **Step 12: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts src/renderer/src/store/useAppStore.cancel.test.ts
git commit -m "feat(cancel): ストアに canceling・tabId 受け渡し・cancelTab を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ResultsGrid に停止ボタンを追加（UI・型/ビルド検証）

「実行中…」表示の横に「停止」ボタンを出す。`canceling` 中は disable して「停止中…」に切替。

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

- [ ] **Step 1: ResultsGrid の running 表示を停止ボタン付きに置き換える**

`src/renderer/src/workspace/ResultsGrid.tsx`:
- フック取得の領域（行43 `const quickFilter = ...` の直後）に追加:
```ts
  const cancelTab = useAppStore((s) => s.cancelTab)
```
- running 表示（行46 `if (tab.running) return <div className={styles.placeholder}>実行中…</div>`）を置き換え:
```tsx
  if (tab.running)
    return (
      <div className={styles.runningBox}>
        <span>実行中…</span>
        <button
          className={styles.stopButton}
          disabled={tab.canceling}
          onClick={() => void cancelTab(tab.id)}
        >
          {tab.canceling ? '停止中…' : '停止'}
        </button>
      </div>
    )
```

- [ ] **Step 2: CSS を追加**

`src/renderer/src/workspace/ResultsGrid.module.css` の末尾に追加:
```css
.runningBox {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.stopButton {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--border, #ccc);
  border-radius: 4px;
  background: var(--surface, #fff);
  color: var(--text, #222);
  cursor: pointer;
}

.stopButton:disabled {
  opacity: 0.6;
  cursor: default;
}
```
> 注: `--text-secondary` 等の変数名は既存の `ResultsGrid.module.css` / グローバル CSS で使われているものに合わせること。無ければ素の色値（上記フォールバック）で可。`.placeholder` の既存配色を踏襲する。

- [ ] **Step 3: 型チェック（全プロジェクト）**

Run: `npm run typecheck`
Expected: エラーなし（main/web 両方。ここで Task 3-5 の web 型も含め全整合を確認）

- [ ] **Step 4: ビルド**

Run: `npm run build`
Expected: 成功

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat(cancel): 結果ペインに停止ボタンを追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 2: MySQL ありで全テスト**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_USER=root TEST_MYSQL_PASSWORD=rootpw TEST_MYSQL_DATABASE=testdb \
  npm run test
```
Expected: 全 PASS・skip ゼロ。新規（queryCancellation 4件・integration cancel 2件・store cancel 1件）が含まれる。

- [ ] **Step 3: ビルド**

Run: `npm run build`
Expected: 成功

- [ ] **Step 4: 後片付け**

Run: `docker compose -f docker-compose.test.yml down`

- [ ] **Step 5: 手動 GUI 確認（推奨・任意）**

`npm run dev` で起動 → 接続 → SQL タブで `SELECT SLEEP(10);` を ⌘↵ →「実行中…」横の「停止」を押す → 速やかに停止し（エラー表示なし）、その後別クエリが通ることを確認。テーブルタブで重いフィルタ中の停止も確認。

---

## Self-Review 結果（記録）

- **Spec coverage:** §3.1 方針=Task2 runCancellable/cancel、§3.2 ConnectionManager（runningQueries/runCancellable/query/queryScript/cancel/threadId フォールバック）=Task2、QueryCancelledError/isQueryInterrupted=Task1、§3.3 IPC（tabId 受け渡し/db:cancel/CANCELLED 変換/履歴）=Task3、§3.4 preload+型=Task4、§3.5 store（canceling/tabId/runTable の isCancelled/cancelTab）=Task5、§3.6 UI 停止ボタン=Task6、§5 テスト（統合 SLEEP/接続生存/no-op・ユニット isQueryInterrupted・store cancelTab）=Task1/2/5、§6 リスク（threadId フォールバック・レース no-op）=Task2 実装に反映。全カバー。
- **Placeholder scan:** TODO/TBD なし。各コードステップは実コードを記載。
- **型/命名一貫性:** `runningQueries`・`runCancellable`・`runOne`・`runScript`・`cancel`・`QueryCancelledError`・`isQueryInterrupted`・`canceling`・`cancelTab`・`cancelQuery`（preload）・`db:cancel`（IPC channel）を全タスクで統一。`query(sql, params, tabId?)` / `queryScript(sql, tabId?)`（main）と `query(tabId, sql, params)` / `queryScript(tabId, sql)`（preload/IPC）の**引数順の違い**は意図的（main は既存 params 互換のため tabId 末尾、IPC/preload は invoke 引数順に合わせ tabId 先頭）で、Task3 のハンドラ `(e, tabId, sql, params)` → `manager.query(sql, params, tabId)` の並べ替えで吸収する。エラーメッセージは既存に合わせ英語 `'Not connected'`。
