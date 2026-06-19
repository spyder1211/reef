# SQLタブ 自動LIMIT ＋ 結果上限ガード（P2）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLタブで素のSELECTを流してもフリーズしないよう、単一の素SELECTに既定 `LIMIT 500` を自動付与し、加えて結果を `10000` 行で打ち切るハード上限ガードを多層で入れる。

**Architecture:** すべてSQLタブ経路（`db:queryScript` → `ConnectionManager.runScript`）に閉じる。自動LIMIT判定は純関数モジュール `autoLimit.ts` に分離し `runScript` から呼ぶ。ハード上限の slice は `runScript` のみで行い、共有 `runOne`（テーブル閲覧・CSV全件エクスポートが使用）には一切触れない。再実行用に `skipAutoLimit` フラグを IPC/preload/store に1本通す。

**Tech Stack:** Electron / TypeScript / React / Zustand / mysql2 / vitest

## Global Constraints

- `DEFAULT_SQL_LIMIT = 500`（ソフト自動LIMIT、verbatim）
- `MAX_RESULT_ROWS = 10000`（ハード上限、verbatim）
- 自動LIMITは「**単一文** かつ **主verbがSELECT**（先頭SELECT または WITH…SELECT）かつ **トップレベルLIMIT無し**」のときのみ付与。それ以外は付与せずハード上限に委ねる。
- 自動LIMIT判定は**例外を投げず、曖昧なら原文を返す**（保守的フォールバック）。
- ハード上限の slice は `runScript` のみ。`runOne`・`query`・CSVエクスポート（`limit:null`）経路は**不変**。
- 履歴（`history.add`）には**ユーザー原文SQL**を残す（自動付与した `LIMIT 500` 入りではない）。
- TDD（テスト先行）・各タスク末尾でコミット。
- 既存テストの緑を維持（リグレッション禁止）。
- ブランチ: `feat/auto-limit-result-guard`（作成済み、spec コミット済み）。

---

### Task 1: 共有定数 ＋ 自動LIMIT判定モジュール

**Files:**
- Create: `src/shared/queryLimits.ts`
- Create: `src/main/connection/autoLimit.ts`
- Test: `src/main/connection/autoLimit.test.ts`

**Interfaces:**
- Produces: `DEFAULT_SQL_LIMIT: number`（=500）, `MAX_RESULT_ROWS: number`（=10000） from `src/shared/queryLimits.ts`
- Produces: `maybeApplyAutoLimit(sql: string, statementCount: number): { sql: string; applied: boolean }` from `src/main/connection/autoLimit.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/connection/autoLimit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { maybeApplyAutoLimit } from './autoLimit'

describe('maybeApplyAutoLimit', () => {
  it('単一の素SELECTに LIMIT 500 を付与する', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM users', 1)).toEqual({
      sql: 'SELECT * FROM users LIMIT 500',
      applied: true
    })
  })

  it('小文字 select でも付与する（大小無視）', () => {
    expect(maybeApplyAutoLimit('select * from t', 1).applied).toBe(true)
  })

  it('ORDER BY の後ろに付与する', () => {
    expect(maybeApplyAutoLimit('SELECT id FROM t ORDER BY id DESC', 1).sql).toBe(
      'SELECT id FROM t ORDER BY id DESC LIMIT 500'
    )
  })

  it('トップレベル LIMIT があれば付与しない', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM t LIMIT 10', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('SELECT * FROM t LIMIT 5, 10', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('SELECT * FROM t LIMIT 10 OFFSET 5', 1).applied).toBe(false)
  })

  it('サブクエリ内の LIMIT のみなら付与する（トップレベルには無い）', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM (SELECT id FROM t LIMIT 5) x', 1).applied).toBe(true)
  })

  it('WITH … SELECT（CTE）に付与する', () => {
    expect(maybeApplyAutoLimit('WITH c AS (SELECT 1 AS n) SELECT * FROM c', 1).applied).toBe(true)
  })

  it('WITH … UPDATE には付与しない', () => {
    expect(maybeApplyAutoLimit('WITH c AS (SELECT id FROM t) UPDATE t SET x = 1', 1).applied).toBe(false)
  })

  it('SELECT 以外（SHOW/DESCRIBE/INSERT/UPDATE）には付与しない', () => {
    expect(maybeApplyAutoLimit('SHOW TABLES', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('DESCRIBE t', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('INSERT INTO t VALUES (1)', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('UPDATE t SET x = 1', 1).applied).toBe(false)
  })

  it('複数文には付与しない', () => {
    expect(maybeApplyAutoLimit('SELECT * FROM t', 2).applied).toBe(false)
  })

  it('文字列リテラル内の括弧やキーワードに惑わされない', () => {
    expect(maybeApplyAutoLimit("SELECT * FROM t WHERE name = 'a (limit) b'", 1)).toEqual({
      sql: "SELECT * FROM t WHERE name = 'a (limit) b' LIMIT 500",
      applied: true
    })
  })

  it('不正・空SQLでも例外を投げず applied=false', () => {
    expect(maybeApplyAutoLimit('', 1).applied).toBe(false)
    expect(maybeApplyAutoLimit('))(( garbage', 1).applied).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/autoLimit.test.ts`
Expected: FAIL（`Cannot find module './autoLimit'`）

- [ ] **Step 3: 定数ファイルを作成**

`src/shared/queryLimits.ts`:
```ts
// SQLタブの結果サイズ制御。設定UIが無いため定数で固定（将来の設定化に備える）。
export const DEFAULT_SQL_LIMIT = 500 // 単一の素SELECTに自動付与するソフトLIMIT
export const MAX_RESULT_ROWS = 10000 // IPC転送のハード上限。超過分は打ち切る
```

- [ ] **Step 4: 判定モジュールを実装**

`src/main/connection/autoLimit.ts`:
```ts
import { DEFAULT_SQL_LIMIT } from '../../shared/queryLimits'

// 主verb候補（先頭または WITH 後に最初に現れる文の種別）。SELECT のときだけ自動LIMIT対象。
const STATEMENT_VERBS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER',
  'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE', 'CALL', 'LOAD',
  'SET', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'USE', 'ANALYZE', 'OPTIMIZE'
])

// 括弧深度0（トップレベル）の英単語トークンを大文字で集める。
// 文字列リテラル（'...' "..."）・バッククォート識別子・括弧内（深度>0）は無視する。
// SqlStatementSplitter 通過後の文はコメント除去済みだが、念のためここではコメント除去はしない。
function topLevelWords(sql: string): string[] {
  const words: string[] = []
  let depth = 0
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (quote !== '`' && sql[i] === '\\') { i += 2; continue } // バックスラッシュエスケープ
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue } // 二重引用符エスケープ（'' ""）
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') { if (depth > 0) depth--; i++; continue }
    if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++
      words.push(sql.slice(i, j).toUpperCase())
      i = j
      continue
    }
    i++
  }
  return words
}

// 単一の素SELECT（先頭SELECT または WITH…SELECT、トップレベルLIMIT無し）のときだけ
// 末尾に LIMIT 500 を付与する。条件を満たさない・判定不能なら原文をそのまま返す。
export function maybeApplyAutoLimit(
  sql: string,
  statementCount: number
): { sql: string; applied: boolean } {
  try {
    if (statementCount !== 1) return { sql, applied: false }
    const words = topLevelWords(sql)
    const mainVerb = words.find((w) => STATEMENT_VERBS.has(w)) // WITH/RECURSIVE/CTE名/AS は跨ぐ
    if (mainVerb !== 'SELECT') return { sql, applied: false }
    if (words.includes('LIMIT')) return { sql, applied: false } // トップレベルLIMITあり
    return { sql: sql.replace(/\s+$/, '') + ` LIMIT ${DEFAULT_SQL_LIMIT}`, applied: true }
  } catch {
    return { sql, applied: false }
  }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/main/connection/autoLimit.test.ts`
Expected: PASS（全ケース緑）

- [ ] **Step 6: コミット**

```bash
git add src/shared/queryLimits.ts src/main/connection/autoLimit.ts src/main/connection/autoLimit.test.ts
git commit -m "feat: 自動LIMIT判定モジュールと共有定数を追加（P2 Task1）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: QueryResult 型拡張 ＋ ConnectionManager（自動LIMIT適用＋ハード上限）

**Files:**
- Modify: `src/shared/types.ts:31-36`（QueryResult に2フィールド追加）
- Modify: `src/main/connection/ConnectionManager.ts:93-114`（queryScript/runScript）
- Test: `src/main/connection/ConnectionManager.queryScript.test.ts`（ユニット・pool モック）
- Test: `src/main/connection/ConnectionManager.integration.test.ts`（統合・実MySQL）

**Interfaces:**
- Consumes: `maybeApplyAutoLimit`（Task 1）, `MAX_RESULT_ROWS`（Task 1）
- Produces: `QueryResult.autoLimited?: boolean`, `QueryResult.truncated?: boolean`
- Produces: `ConnectionManager.queryScript(sql: string, tabId?: string, opts?: { skipAutoLimit?: boolean }): Promise<QueryResult>`

- [ ] **Step 1: 失敗するユニットテストを追加**

`src/main/connection/ConnectionManager.queryScript.test.ts` の `describe` 内末尾に追記:
```ts
  it('単一の素SELECTには LIMIT 500 を付けて実行し autoLimited=true', async () => {
    const { mgr, query } = withQueryPool(() => [[{ a: 1 }], [{ name: 'a' }]])
    const res = await mgr.queryScript('SELECT 1 AS a')
    expect(query).toHaveBeenCalledWith('SELECT 1 AS a LIMIT 500', undefined)
    expect(res.autoLimited).toBe(true)
  })

  it('skipAutoLimit=true なら LIMIT を付けない', async () => {
    const { mgr, query } = withQueryPool(() => [[{ a: 1 }], [{ name: 'a' }]])
    const res = await mgr.queryScript('SELECT 1 AS a', undefined, { skipAutoLimit: true })
    expect(query).toHaveBeenCalledWith('SELECT 1 AS a', undefined)
    expect(res.autoLimited).toBeUndefined()
  })

  it('結果が MAX_RESULT_ROWS を超えたら打ち切り truncated=true', async () => {
    const big = Array.from({ length: 10001 }, (_v, i) => ({ id: i }))
    const { mgr } = withQueryPool(() => [big, [{ name: 'id' }]])
    // 明示LIMITありにして自動LIMITを回避し、ハード上限のみ効かせる
    const res = await mgr.queryScript('SELECT id FROM t LIMIT 100000')
    expect(res.rowCount).toBe(10000)
    expect(res.rows).toHaveLength(10000)
    expect(res.truncated).toBe(true)
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/ConnectionManager.queryScript.test.ts`
Expected: FAIL（`LIMIT 500` 未付与・`autoLimited`/`truncated` 未定義）

- [ ] **Step 3: QueryResult 型を拡張**

`src/shared/types.ts` の `QueryResult` を次に変更:
```ts
export interface QueryResult {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  autoLimited?: boolean // 単一素SELECTに自動 LIMIT 500 を付与した（SQLタブのみ）
  truncated?: boolean // 結果が MAX_RESULT_ROWS を超えたため打ち切った（SQLタブのみ）
}
```

- [ ] **Step 4: ConnectionManager を実装**

`src/main/connection/ConnectionManager.ts` の import に追加（先頭付近）:
```ts
import { maybeApplyAutoLimit } from './autoLimit'
import { MAX_RESULT_ROWS } from '../../shared/queryLimits'
```

`queryScript`（行93-100）を次に置き換え:
```ts
  async queryScript(
    sql: string,
    tabId?: string,
    opts?: { skipAutoLimit?: boolean }
  ): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const splitter = new SqlStatementSplitter()
    const statements = [...splitter.push(sql), ...splitter.end()]
    if (statements.length === 0) return { columns: [], rows: [], rowCount: 0, durationMs: 0 }
    if (tabId) return this.runCancellable(tabId, (conn) => this.runScript(conn, statements, opts))
    return this.runScript(this.pool, statements, opts)
  }
```

`runScript`（行104-114）を次に置き換え:
```ts
  // 分割済みの文を execer 上で順次実行し、最後の文の結果＋全体所要時間を返す。
  // 単一の素SELECT（!skipAutoLimit）には LIMIT 500 を自動付与し autoLimited を立てる。
  // 最終結果が MAX_RESULT_ROWS を超えたら slice して truncated を立てる（SQLタブ専用ガード）。
  private async runScript(
    execer: mysql.Pool | mysql.PoolConnection,
    statements: string[],
    opts?: { skipAutoLimit?: boolean }
  ): Promise<QueryResult> {
    const start = Date.now()
    let last: QueryResult = { columns: [], rows: [], rowCount: 0, durationMs: 0 }
    const useAutoLimit = statements.length === 1 && !opts?.skipAutoLimit
    let autoLimited = false
    for (const stmt of statements) {
      let toRun = stmt
      if (useAutoLimit) {
        const r = maybeApplyAutoLimit(stmt, statements.length)
        toRun = r.sql
        autoLimited = r.applied
      }
      last = await this.runOne(execer, toRun)
    }
    let rows = last.rows
    let truncated = false
    if (rows.length > MAX_RESULT_ROWS) {
      rows = rows.slice(0, MAX_RESULT_ROWS)
      truncated = true
    }
    const result: QueryResult = {
      ...last,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - start
    }
    if (autoLimited) result.autoLimited = true
    if (truncated) result.truncated = true
    return result
  }
```

- [ ] **Step 5: ユニットテストが通ることを確認**

Run: `npx vitest run src/main/connection/ConnectionManager.queryScript.test.ts`
Expected: PASS（追加3件＋既存3件すべて緑。既存の2文テストは `LIMIT` 未付与のまま）

- [ ] **Step 6: 失敗する統合テストを追加**

`src/main/connection/ConnectionManager.integration.test.ts` の `describe.skipIf` ブロック内末尾に追記:
```ts
  it('SQLタブ: 単一の素SELECTは自動 LIMIT 500 が効き autoLimited=true', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS al_demo (id INT)')
    await mgr.query('DELETE FROM al_demo')
    const values = Array.from({ length: 600 }, (_v, i) => `(${i})`).join(',')
    await mgr.query(`INSERT INTO al_demo (id) VALUES ${values}`)

    const res = await mgr.queryScript('SELECT * FROM al_demo')
    expect(res.rowCount).toBe(500)
    expect(res.autoLimited).toBe(true)
  })

  it('SQLタブ: skipAutoLimit=true なら全件返る（autoLimited なし）', async () => {
    const res = await mgr.queryScript('SELECT * FROM al_demo', undefined, { skipAutoLimit: true })
    expect(res.rowCount).toBe(600)
    expect(res.autoLimited).toBeUndefined()
  })

  it('SQLタブ: 明示の巨大LIMITは MAX_RESULT_ROWS=10000 で打ち切る', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS hc_demo (id INT)')
    await mgr.query('DELETE FROM hc_demo')
    // 10001 行を挿入（1000 件ずつ）
    for (let base = 0; base < 10001; base += 1000) {
      const cnt = Math.min(1000, 10001 - base)
      const vals = Array.from({ length: cnt }, (_v, i) => `(${base + i})`).join(',')
      await mgr.query(`INSERT INTO hc_demo (id) VALUES ${vals}`)
    }
    const res = await mgr.queryScript('SELECT id FROM hc_demo LIMIT 100000')
    expect(res.rowCount).toBe(10000)
    expect(res.truncated).toBe(true)
  })
```

- [ ] **Step 7: 統合テストが通ることを確認**

```bash
docker compose -f docker-compose.test.yml up -d
# MySQL の healthy 待ち（数秒）
TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_USER=root \
  TEST_MYSQL_PASSWORD=rootpw TEST_MYSQL_DATABASE=testdb \
  npx vitest run src/main/connection/ConnectionManager.integration.test.ts
```
Expected: PASS（追加3件含め全件緑）

- [ ] **Step 8: 全スイートでリグレッション確認**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck エラーなし。全テスト緑（実DB env 無しなら統合は skip）。

- [ ] **Step 9: コミット**

```bash
git add src/shared/types.ts src/main/connection/ConnectionManager.ts \
  src/main/connection/ConnectionManager.queryScript.test.ts \
  src/main/connection/ConnectionManager.integration.test.ts
git commit -m "feat: SQLタブに自動LIMITとハード上限ガードを実装（P2 Task2）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: IPC ＋ preload ＋ 型宣言 ＋ store プラミング（skipAutoLimit）

**Files:**
- Modify: `src/main/ipc/registerDbHandlers.ts:57-73`（db:queryScript に skipAutoLimit）
- Modify: `src/preload/index.ts:24-25`（queryScript シグネチャ）
- Modify: `src/renderer/src/env.d.ts:26`（window.api 型）
- Modify: `src/renderer/src/store/useAppStore.ts`（runSql opts ＋ rerunWithoutAutoLimit アクション）
- Test: `src/renderer/src/store/useAppStore.autolimit.test.ts`（新規）

**Interfaces:**
- Consumes: `ConnectionManager.queryScript(sql, tabId?, opts?)`（Task 2）, `QueryResult.autoLimited/truncated`（Task 2）
- Produces: `window.api.queryScript(tabId, sql, skipAutoLimit?)`
- Produces: store action `rerunWithoutAutoLimit(tabId: string): Promise<void>`

- [ ] **Step 1: 失敗する store テストを書く**

`src/renderer/src/store/useAppStore.autolimit.test.ts`（新規）:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'

function seedSqlTab(): void {
  useAppStore.setState({
    tabs: [
      {
        kind: 'sql', id: 'tab-1', title: 'Q', sql: 'SELECT * FROM users',
        result: null, error: null, running: false, canceling: false
      }
    ] as never,
    activeTabId: 'tab-1'
  })
}

describe('SQLタブ 自動LIMIT プラミング', () => {
  beforeEach(seedSqlTab)
  afterEach(() => vi.unstubAllGlobals())

  it('runActiveTab は skipAutoLimit を渡さず実行し、autoLimited を結果に格納する', async () => {
    const queryScript = vi.fn(async () => ({
      ok: true,
      data: { columns: [], rows: [], rowCount: 500, durationMs: 1, autoLimited: true }
    }))
    vi.stubGlobal('window', { api: { queryScript } })

    await useAppStore.getState().runActiveTab()

    expect(queryScript).toHaveBeenCalledWith('tab-1', 'SELECT * FROM users', undefined)
    const tab = useAppStore.getState().tabs.find((t) => t.id === 'tab-1')
    expect((tab as { result: { autoLimited?: boolean } }).result.autoLimited).toBe(true)
  })

  it('rerunWithoutAutoLimit は skipAutoLimit=true で再実行する', async () => {
    const queryScript = vi.fn(async () => ({
      ok: true,
      data: { columns: [], rows: [], rowCount: 600, durationMs: 1 }
    }))
    vi.stubGlobal('window', { api: { queryScript } })

    await useAppStore.getState().rerunWithoutAutoLimit('tab-1')

    expect(queryScript).toHaveBeenCalledWith('tab-1', 'SELECT * FROM users', true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/useAppStore.autolimit.test.ts`
Expected: FAIL（`rerunWithoutAutoLimit` 未定義 ／ queryScript 呼び出し引数不一致）

- [ ] **Step 3: IPC ハンドラに skipAutoLimit を追加**

`src/main/ipc/registerDbHandlers.ts` の `db:queryScript`（行57-73）を次に置き換え:
```ts
  ipcMain.handle(
    'db:queryScript',
    async (e, tabId: string, sql: string, skipAutoLimit?: boolean): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      // キャンセル（実行前ガード／実行中 KILL）は履歴に残さない。成功/失敗時のみ history.add。
      // 履歴にはユーザー原文 sql を残す（自動付与した LIMIT 入りではない）。
      try {
        const data = await manager.queryScript(sql, tabId, { skipAutoLimit })
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

- [ ] **Step 4: preload と型宣言を更新**

`src/preload/index.ts` の `queryScript`（行24-25）を次に置き換え:
```ts
  // SQL エディタ用：複数文を ; で分割して順に実行（main 側）。skipAutoLimit で自動LIMITを外す。
  queryScript: (tabId: string, sql: string, skipAutoLimit?: boolean): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:queryScript', tabId, sql, skipAutoLimit),
```

`src/renderer/src/env.d.ts` の行26 を次に置き換え:
```ts
      queryScript: (tabId: string, sql: string, skipAutoLimit?: boolean) => Promise<ApiResult<QueryResult>>
```

- [ ] **Step 5: store の runSql と新アクションを実装**

`src/renderer/src/store/useAppStore.ts` の `runSql`（行247行目）のシグネチャと呼び出しを次に変更:
```ts
  async function runSql(
    tabId: string,
    sql: string,
    opts?: { skipAutoLimit?: boolean }
  ): Promise<void> {
    setTabRunning(tabId)
    try {
      // SQL エディタは複数文を1回で全実行する（; で分割して逐次実行）。
      const res = await window.api.queryScript(tabId, sql, opts?.skipAutoLimit)
```
（`runSql` の本体の残り（`isCancelled` 分岐・結果格納）はそのまま。`result: res.ok ? res.data : null` で `autoLimited`/`truncated` も自動的にタブへ格納される。）

store が返すアクションオブジェクト内、`runActiveTab`（行553-568）の直後に新アクションを追加:
```ts
    // 注記の「自動LIMITを外して再実行」ボタン用。同じ SQL を skipAutoLimit=true で再実行する。
    async rerunWithoutAutoLimit(tabId: string) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (!tab || tab.kind !== 'sql') return
      await runSql(tabId, tab.sql, { skipAutoLimit: true })
    },
```

`runActiveTab` 内の sql 分岐（行556）はそのまま `await runSql(tab.id, tab.sql)` で良い（opts 省略＝自動LIMIT有効、queryScript には skipAutoLimit=undefined が渡る）。

> 注: `rerunWithoutAutoLimit` を store の型（State/Actions interface）に宣言している場合は、その型定義にも `rerunWithoutAutoLimit: (tabId: string) => Promise<void>` を追加すること（typecheck で検出される）。

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/useAppStore.autolimit.test.ts`
Expected: PASS（2件緑）

- [ ] **Step 7: typecheck と全スイート**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck エラーなし。全テスト緑。

- [ ] **Step 8: コミット**

```bash
git add src/main/ipc/registerDbHandlers.ts src/preload/index.ts \
  src/renderer/src/env.d.ts src/renderer/src/store/useAppStore.ts \
  src/renderer/src/store/useAppStore.autolimit.test.ts
git commit -m "feat: skipAutoLimit を IPC/preload/store に通し再実行アクションを追加（P2 Task3）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: ResultsGrid の注記バナー（自動LIMIT／打ち切り）＋ 再実行ボタン

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx:67-69` 付近（結果ヘッダに注記を追加）
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`（注記バナーのスタイル追加）

**Interfaces:**
- Consumes: `QueryResult.autoLimited/truncated`（Task 2）, store action `rerunWithoutAutoLimit`（Task 3）, 定数 `DEFAULT_SQL_LIMIT`/`MAX_RESULT_ROWS`（Task 1）

このタスクは UI 表示で、本プロジェクトにコンポーネントテスト基盤が無いため typecheck＋build＋手動確認で検証する（既存方針に準拠）。

- [ ] **Step 1: ResultsGrid に注記バナーを実装**

`src/renderer/src/workspace/ResultsGrid.tsx` の import に追加:
```ts
import { DEFAULT_SQL_LIMIT, MAX_RESULT_ROWS } from '../../../shared/queryLimits'
```

`ResultsGrid` コンポーネント先頭の store セレクタ群（行44 `cancelTab` の隣）に追加:
```ts
  const rerunWithoutAutoLimit = useAppStore((s) => s.rerunWithoutAutoLimit)
```

結果ヘッダの注記を、グリッド本体 `Grid` を返す直前（`if (!tab.result)` ガードの後、行69以降で実際に結果を描画する箇所の手前）に差し込む。`tab.result` が存在する文脈で `result` を参照し、SQLタブのみ注記を出す:
```tsx
  const notice =
    tab.kind === 'sql' && tab.result?.autoLimited ? (
      <div className={styles.limitNotice}>
        <span>先頭 {DEFAULT_SQL_LIMIT} 件を表示中（自動LIMIT・全件ではありません）</span>
        <button className={styles.limitNoticeButton} onClick={() => void rerunWithoutAutoLimit(tab.id)}>
          自動LIMITを外して再実行
        </button>
      </div>
    ) : tab.kind === 'sql' && tab.result?.truncated ? (
      <div className={styles.limitNotice}>
        <span>
          結果が大きいため先頭 {MAX_RESULT_ROWS} 件で打ち切りました。全件はCSVエクスポートを使用してください。
        </span>
      </div>
    ) : null
```
そして既存の結果描画の返却 JSX のルート直下（グリッドの上）に `{notice}` を配置する。例（既存のラッパに合わせて）:
```tsx
  return (
    <div className={styles.wrapper}>
      {notice}
      {/* 既存のグリッド描画（Grid コンポーネント等）はそのまま */}
      ...
    </div>
  )
```
> 既存の return 構造に合わせて `{notice}` を結果テーブルの直前に挿入すること。`notice` は `null` のとき何も描画しない。

- [ ] **Step 2: 注記バナーの CSS を追加**

`src/renderer/src/workspace/ResultsGrid.module.css` の末尾に追加:
```css
.limitNotice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  font-size: 12px;
  background: var(--notice-bg, #3a3320);
  color: var(--notice-fg, #e8d8a0);
  border-bottom: 1px solid var(--border, #444);
}

.limitNoticeButton {
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border, #666);
  border-radius: 4px;
  background: transparent;
  color: inherit;
}

.limitNoticeButton:hover {
  background: rgba(255, 255, 255, 0.08);
}
```
> 既存の CSS 変数命名（ダークモード対応）に合わせて色トークンを調整すること。既存ファイル冒頭の変数定義を確認し、無ければ上記のフォールバック値（`#...`）で良い。

- [ ] **Step 3: typecheck と build で検証**

Run: `npm run typecheck && npm run build`
Expected: 型エラー・ビルドエラーなし。

- [ ] **Step 4: 手動確認（実DB接続）**

```bash
docker compose -f docker-compose.test.yml up -d
npm run dev
```
確認項目:
1. SQLタブで `SELECT * FROM <600行以上のテーブル>` を実行 → 「先頭 500 件を表示中（自動LIMIT…）」バナーと「自動LIMITを外して再実行」ボタンが出る。
2. ボタン押下 → 全件（≤10000）が再取得され、バナーが消える（autoLimited が下りる）。
3. `SELECT * FROM <10000行超> LIMIT 100000` → 「先頭 10000 件で打ち切り…」バナーが出る（再実行ボタンなし）。
4. `SELECT * FROM t LIMIT 10` のように明示LIMIT → バナーは出ない。
5. テーブル閲覧（サイドバーからテーブルを開く）・CSVエクスポートは従来どおり（注記なし・全件エクスポート可）。

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: 自動LIMIT／打ち切りの注記バナーと再実行ボタンを追加（P2 Task4）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review（計画作成者によるチェック）

**1. Spec coverage（spec の各節 → タスク対応）:**
- §3.2 共有定数 → Task 1 Step 3 ✓
- §3.3 自動LIMIT判定モジュール（単一文・SELECT/WITH…SELECT・トップレベルLIMIT・保守的フォールバック）→ Task 1 ✓
- §3.4 ConnectionManager（runScript の自動LIMIT適用＋ハード上限 slice、CSV経路不変）→ Task 2 ✓
- §3.5 QueryResult 型（autoLimited/truncated）→ Task 2 Step 3 ✓
- §3.6 IPC/preload/store（skipAutoLimit、履歴は原文SQL）→ Task 3 ✓
- §3.7 renderer UI（注記＋再実行ボタン、打ち切り注記）→ Task 4 ✓
- §6 テスト（autoLimit ユニット／queryScript pool モック／統合／store）→ Task 1,2,3 ✓
- §6 リグレッション（query/CSV 不変）→ Task 2 Step 8・Task 4 Step 4-5 ✓

**2. Placeholder scan:** TBD/TODO/「適切に処理」等なし。各コードステップに実コードあり ✓

**3. Type consistency:**
- `maybeApplyAutoLimit(sql, statementCount): { sql, applied }` — Task 1 定義 / Task 2 使用 一致 ✓
- `queryScript(sql, tabId?, opts?: { skipAutoLimit?: boolean })` — Task 2 定義 / Task 3 使用（`{ skipAutoLimit }`）一致 ✓
- `window.api.queryScript(tabId, sql, skipAutoLimit?)` — Task 3 preload/env.d.ts/store 一致 ✓
- `QueryResult.autoLimited/truncated` — Task 2 定義 / Task 3 store・Task 4 UI 参照 一致 ✓
- `rerunWithoutAutoLimit(tabId)` — Task 3 定義 / Task 4 使用 一致 ✓
- 定数 `DEFAULT_SQL_LIMIT=500`/`MAX_RESULT_ROWS=10000` — Task 1 定義 / 全タスク参照 一致 ✓
