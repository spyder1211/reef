# テーブルビューのセル編集（UPDATE）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルビュー（主キーあり）のグリッドでセルを直接編集し、変更をためて1トランザクションで一括 UPDATE できるようにする。

**Architecture:** main 側に主キー検出（`primaryKey`）とトランザクション一括適用（`applyChanges`）を追加し IPC で公開。レンダラは純粋関数 `editBuilder`（UPDATE 文生成）と `rowKey`（行同定）を使い、Zustand の `TableTab` に `primaryKey` / `edits`（ステージング）/ `editError` を持たせる。UI は `ResultsGrid` のセルをインライン編集可能にし、変更がある時だけ `EditBar`（破棄 / コミット ⌘S）を表示する。

**Tech Stack:** Electron + React 18 + TypeScript / Zustand / @tanstack/react-table / mysql2 / Vitest / CSS Modules

**Spec:** `docs/superpowers/specs/2026-06-07-cell-editing-update-design.md`

---

## File Structure

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/shared/types.ts` | 変更 | `RowEdit` / `SqlStatement` 型を追加 |
| `src/renderer/src/store/editBuilder.ts`(+test) | 新規 | RowEdit[] → UPDATE 文（純粋） |
| `src/renderer/src/store/rowKey.ts`(+test) | 新規 | 行キー生成・主キー値抽出（純粋） |
| `src/main/connection/ConnectionManager.ts` | 変更 | `primaryKey()` / `applyChanges()` |
| `src/main/ipc/registerDbHandlers.ts` | 変更 | `db:primaryKey` / `db:applyChanges` |
| `src/preload/index.ts` | 変更 | `primaryKey` / `applyChanges` ブリッジ |
| `src/renderer/src/env.d.ts` | 変更 | API 型 |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | PK/トランザクション結合テスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | TableTab 拡張・編集アクション・ナビ保護 |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | セル編集 UI |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | 編集中/変更済みセルのスタイル |
| `src/renderer/src/workspace/EditBar.tsx`(+css) | 新規 | コミットバー |
| `src/renderer/src/workspace/WorkspaceShell.tsx` | 変更 | EditBar 配線 |

---

## Task 1: 共有型 + editBuilder（UPDATE 文生成）

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/renderer/src/store/editBuilder.ts`
- Test: `src/renderer/src/store/editBuilder.test.ts`

- [ ] **Step 1: 共有型を追加**

`src/shared/types.ts` の末尾（`TableSort` の後）に追加:

```ts

// 1行分のステージング中の編集（UPDATE 用）
export interface RowEdit {
  pk: Record<string, unknown> // オリジナル行の主キー列 → 値（WHERE 用）
  values: Record<string, string | null> // 変更された列 → 新しい値（SET 用）
}

// パラメータ化された 1 文（IPC で main に渡してトランザクション実行する）
export interface SqlStatement {
  sql: string
  params: unknown[]
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/store/editBuilder.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import { buildUpdateStatements } from './editBuilder'
import type { RowEdit } from '../../../shared/types'

describe('buildUpdateStatements', () => {
  it('単一列 UPDATE', () => {
    const edits: RowEdit[] = [{ pk: { id: 1 }, values: { name: '山田' } }]
    expect(buildUpdateStatements('users', ['id'], edits)).toEqual([
      { sql: 'UPDATE `users` SET `name` = ? WHERE `id` = ?', params: ['山田', 1] }
    ])
  })

  it('複数列 UPDATE', () => {
    const edits: RowEdit[] = [{ pk: { id: 2 }, values: { name: '太郎', status: 'x' } }]
    const r = buildUpdateStatements('users', ['id'], edits)
    expect(r[0].sql).toBe('UPDATE `users` SET `name` = ?, `status` = ? WHERE `id` = ?')
    expect(r[0].params).toEqual(['太郎', 'x', 2])
  })

  it('複合主キーは WHERE を AND 結合し pk 値を使う', () => {
    const edits: RowEdit[] = [{ pk: { a: 1, b: 2 }, values: { n: '9' } }]
    const r = buildUpdateStatements('t', ['a', 'b'], edits)
    expect(r[0].sql).toBe('UPDATE `t` SET `n` = ? WHERE `a` = ? AND `b` = ?')
    expect(r[0].params).toEqual(['9', 1, 2])
  })

  it('NULL 値は param が null', () => {
    const edits: RowEdit[] = [{ pk: { id: 1 }, values: { name: null } }]
    const r = buildUpdateStatements('t', ['id'], edits)
    expect(r[0].params).toEqual([null, 1])
  })

  it('識別子のバッククォートを2重化', () => {
    const edits: RowEdit[] = [{ pk: { 'i`d': 1 }, values: { 'c`ol': 'v' } }]
    const r = buildUpdateStatements('we`ird', ['i`d'], edits)
    expect(r[0].sql).toBe('UPDATE `we``ird` SET `c``ol` = ? WHERE `i``d` = ?')
  })

  it('values 空の行はスキップ', () => {
    const edits: RowEdit[] = [
      { pk: { id: 1 }, values: {} },
      { pk: { id: 2 }, values: { n: '1' } }
    ]
    const r = buildUpdateStatements('t', ['id'], edits)
    expect(r).toHaveLength(1)
    expect(r[0].params).toEqual(['1', 2])
  })

  it('主キー空なら空配列', () => {
    expect(buildUpdateStatements('t', [], [{ pk: {}, values: { n: '1' } }])).toEqual([])
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/editBuilder.test.ts`
Expected: FAIL（`./editBuilder` が存在しない）

- [ ] **Step 4: editBuilder.ts を実装**

`src/renderer/src/store/editBuilder.ts` を新規作成:

```ts
import type { RowEdit, SqlStatement } from '../../../shared/types'

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/**
 * ステージング中の各 RowEdit を1つの UPDATE 文にする。
 * 値は必ず `?` プレースホルダ、識別子はバッククォート2重化でエスケープ。
 * WHERE は主キー列を AND で結び、値は edit.pk（編集前のオリジナル値）を使う。
 * values が空の行・主キーが空の場合はスキップ/空配列。
 */
export function buildUpdateStatements(
  table: string,
  primaryKey: string[],
  edits: RowEdit[]
): SqlStatement[] {
  if (primaryKey.length === 0) return []
  const statements: SqlStatement[] = []
  for (const edit of edits) {
    const cols = Object.keys(edit.values)
    if (cols.length === 0) continue
    const setClause = cols.map((c) => `${quoteIdent(c)} = ?`).join(', ')
    const whereClause = primaryKey.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const params = [...cols.map((c) => edit.values[c]), ...primaryKey.map((c) => edit.pk[c])]
    statements.push({
      sql: `UPDATE ${quoteIdent(table)} SET ${setClause} WHERE ${whereClause}`,
      params
    })
  }
  return statements
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/editBuilder.test.ts`
Expected: PASS

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/shared/types.ts src/renderer/src/store/editBuilder.ts src/renderer/src/store/editBuilder.test.ts
git commit -m "feat: RowEdit/SqlStatement 型と UPDATE 文ビルダ editBuilder を追加 (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 行同定の純粋関数（rowKey）

**Files:**
- Create: `src/renderer/src/store/rowKey.ts`
- Test: `src/renderer/src/store/rowKey.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/store/rowKey.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import { rowKeyOf, pkValuesOf } from './rowKey'

describe('rowKeyOf', () => {
  it('主キー値が同じなら他列が違っても同じキー', () => {
    expect(rowKeyOf(['id'], { id: 1, x: 9 })).toBe(rowKeyOf(['id'], { id: 1, x: 7 }))
  })
  it('主キー値が違えば別キー', () => {
    expect(rowKeyOf(['id'], { id: 1 })).not.toBe(rowKeyOf(['id'], { id: 2 }))
  })
  it('複合主キー', () => {
    expect(rowKeyOf(['a', 'b'], { a: 1, b: 2 })).toBe(JSON.stringify([1, 2]))
  })
})

describe('pkValuesOf', () => {
  it('主キー列だけ抜き出す', () => {
    expect(pkValuesOf(['a', 'b'], { a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2 })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/rowKey.test.ts`
Expected: FAIL（`./rowKey` が存在しない）

- [ ] **Step 3: rowKey.ts を実装**

`src/renderer/src/store/rowKey.ts` を新規作成:

```ts
// 主キー列のオリジナル値から安定した文字列キーを生成（ページ/ソートで行配列が変わっても同じ行を指せる）。
export function rowKeyOf(primaryKey: string[], row: Record<string, unknown>): string {
  return JSON.stringify(primaryKey.map((c) => row[c]))
}

// 行から主キー列の値だけを抜き出す（WHERE 用のオリジナル主キー値）。
export function pkValuesOf(
  primaryKey: string[],
  row: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(primaryKey.map((c) => [c, row[c]]))
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/rowKey.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/store/rowKey.ts src/renderer/src/store/rowKey.test.ts
git commit -m "feat: 行同定の純粋関数 rowKey (rowKeyOf/pkValuesOf) を追加 (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: バックエンド（主キー検出 + トランザクション一括適用 + IPC）

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`
- Modify: `src/main/ipc/registerDbHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`
- Test: `src/main/connection/ConnectionManager.integration.test.ts`

- [ ] **Step 1: ConnectionManager に primaryKey / applyChanges を追加**

`src/main/connection/ConnectionManager.ts` の import に `SqlStatement` を追加:

```ts
import type { ConnectionConfig, QueryResult, SqlStatement } from '../../shared/types'
```

`listTables()` メソッドの直後（`isConnected()` の前）に次の2メソッドを追加:

```ts
  // 主キー列名を Seq_in_index 順で返す。主キーがなければ []（複合主キー対応）。
  async primaryKey(table: string): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected')
    const quoted = '`' + table.replace(/`/g, '``') + '`'
    const [rows] = await this.pool.query(`SHOW KEYS FROM ${quoted} WHERE Key_name = 'PRIMARY'`)
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    return list
      .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
      .map((r) => String(r.Column_name))
  }

  // 複数の文を1トランザクションで適用。1つでも失敗したら全ロールバックして再 throw。
  async applyChanges(statements: SqlStatement[]): Promise<{ affectedRows: number }> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      let affectedRows = 0
      for (const s of statements) {
        const [result] = await conn.query(s.sql, s.params)
        affectedRows += (result as { affectedRows?: number }).affectedRows ?? 0
      }
      await conn.commit()
      return { affectedRows }
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }
```

- [ ] **Step 2: IPC ハンドラを追加**

`src/main/ipc/registerDbHandlers.ts` の import に `SqlStatement` を追加:

```ts
import type { ConnectionConfig, ApiResult, QueryResult, SqlStatement } from '../../shared/types'
```

`db:listTables` ハンドラの直後（`registerDbHandlers` の閉じ括弧 `}` の直前）に追加:

```ts

  ipcMain.handle(
    'db:primaryKey',
    async (_e, table: string): Promise<ApiResult<string[]>> => {
      try {
        return { ok: true, data: await manager.primaryKey(table) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'db:applyChanges',
    async (_e, statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> => {
      try {
        return { ok: true, data: await manager.applyChanges(statements) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )
```

- [ ] **Step 3: preload にブリッジを追加**

`src/preload/index.ts` の import に `SqlStatement` を追加:

```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement
} from '../shared/types'
```

`listTables` の行の直後に追加（`connections:` オブジェクトの前）:

```ts
  primaryKey: (table: string): Promise<ApiResult<string[]>> =>
    ipcRenderer.invoke('db:primaryKey', table),
  applyChanges: (statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> =>
    ipcRenderer.invoke('db:applyChanges', statements),
```

- [ ] **Step 4: env.d.ts に型を追加**

`src/renderer/src/env.d.ts` の import に `SqlStatement` を追加:

```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement
} from '../../shared/types'
```

`listTables: () => Promise<ApiResult<string[]>>` の行の直後に追加:

```ts
      primaryKey: (table: string) => Promise<ApiResult<string[]>>
      applyChanges: (statements: SqlStatement[]) => Promise<ApiResult<{ affectedRows: number }>>
```

- [ ] **Step 5: 結合テストを追記**

`src/main/connection/ConnectionManager.integration.test.ts` の最後の `it(...)` ブロックの**閉じ括弧 `})` の直後**（`describe` を閉じる `})` の直前）に追加:

```ts

  it('primaryKey: 主キー列を返す / 主キーなしは空配列', async () => {
    await mgr.query('DROP TABLE IF EXISTS pk_demo')
    await mgr.query('CREATE TABLE pk_demo (id INT PRIMARY KEY, name VARCHAR(50))')
    expect(await mgr.primaryKey('pk_demo')).toEqual(['id'])
    await mgr.query('DROP TABLE IF EXISTS nopk_demo')
    await mgr.query('CREATE TABLE nopk_demo (a INT, b INT)')
    expect(await mgr.primaryKey('nopk_demo')).toEqual([])
  })

  it('primaryKey: 複合主キーを Seq_in_index 順で返す', async () => {
    await mgr.query('DROP TABLE IF EXISTS cpk_demo')
    await mgr.query('CREATE TABLE cpk_demo (a INT, b INT, PRIMARY KEY (a, b))')
    expect(await mgr.primaryKey('cpk_demo')).toEqual(['a', 'b'])
  })

  it('applyChanges: 複数 UPDATE をトランザクションで適用', async () => {
    await mgr.query('DROP TABLE IF EXISTS ac_demo')
    await mgr.query('CREATE TABLE ac_demo (id INT PRIMARY KEY, n INT)')
    await mgr.query('INSERT INTO ac_demo (id, n) VALUES (1,10),(2,20)')
    const res = await mgr.applyChanges([
      { sql: 'UPDATE `ac_demo` SET `n` = ? WHERE `id` = ?', params: [11, 1] },
      { sql: 'UPDATE `ac_demo` SET `n` = ? WHERE `id` = ?', params: [22, 2] }
    ])
    expect(res.affectedRows).toBe(2)
    const after = await mgr.query('SELECT n FROM ac_demo ORDER BY id')
    expect(after.rows.map((r) => r.n)).toEqual([11, 22])
  })

  it('applyChanges: 1文でも失敗すると全ロールバック', async () => {
    await mgr.query('DROP TABLE IF EXISTS ac_rollback')
    await mgr.query('CREATE TABLE ac_rollback (id INT PRIMARY KEY, n INT NOT NULL)')
    await mgr.query('INSERT INTO ac_rollback (id, n) VALUES (1,10)')
    await expect(
      mgr.applyChanges([
        { sql: 'UPDATE `ac_rollback` SET `n` = ? WHERE `id` = ?', params: [99, 1] },
        { sql: 'UPDATE `ac_rollback` SET `n` = ? WHERE `id` = ?', params: [null, 1] }
      ])
    ).rejects.toBeTruthy()
    const after = await mgr.query('SELECT n FROM ac_rollback WHERE id = 1')
    expect(after.rows[0].n).toBe(10)
  })
```

- [ ] **Step 6: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`

- [ ] **Step 7: 結合テストを実行（docker 起動済みの場合）**

Run: `docker compose -f docker-compose.test.yml up -d && TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts`
Expected: 全 PASS（新規 4 件含む、計 11）。docker が無ければ skip でも可。実行した場合は `docker compose -f docker-compose.test.yml down` で後片付け。

- [ ] **Step 8: 既存ユニットが緑であることを確認**

Run: `npm test`
Expected: 全ユニット PASS（結合は TEST_MYSQL_HOST 未設定で skip）

- [ ] **Step 9: コミット**

```bash
git add src/main/connection/ConnectionManager.ts src/main/ipc/registerDbHandlers.ts src/preload/index.ts src/renderer/src/env.d.ts src/main/connection/ConnectionManager.integration.test.ts
git commit -m "feat: 主キー検出とトランザクション一括適用(applyChanges)をmain/IPCに追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ストア拡張（編集ステージング・コミット・ナビ保護）

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

検証は型チェック + 既存ユニット（純粋ロジックは Task 1/2、バックエンドは Task 3 結合でカバー済み）。

- [ ] **Step 1: import を更新**

`src/renderer/src/store/useAppStore.ts` の import ブロックを次に置き換え:

```ts
import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult,
  FilterCondition,
  TableSort,
  RowEdit
} from '../../../shared/types'
import { buildFilteredQuery, buildCountQuery } from './filterBuilder'
import { buildUpdateStatements } from './editBuilder'
import { rowKeyOf, pkValuesOf } from './rowKey'
import { pickNextActiveTabId } from './helpers'
import { cycleSort } from './pager'
```

- [ ] **Step 2: TableTab に3フィールドを追加**

`export interface TableTab extends BaseTab { ... }` の `total: number | null` 行の直後に追加:

```ts
  primaryKey: string[] // 主キー列（空 = 読み取り専用）
  edits: Record<string, RowEdit> // 行キー → ステージング中の変更。空 = 変更なし
  editError: AppError | null // コミット失敗のエラー（EditBar に表示）
```

- [ ] **Step 3: makeTableTab を更新**

`makeTableTab` の `total: null,` 行の直後に追加:

```ts
    primaryKey: [],
    edits: {},
    editError: null,
```

- [ ] **Step 4: AppState にアクション型を追加**

`interface AppState { ... }` 内、`setPageSize: (tabId: string, size: number) => Promise<void>` の行の直後に追加:

```ts
  setCellEdit: (tabId: string, row: Record<string, unknown>, column: string, value: string) => void
  setCellNull: (tabId: string, row: Record<string, unknown>, column: string) => void
  discardEdits: (tabId: string) => void
  commitEdits: (tabId: string) => Promise<void>
```

- [ ] **Step 5: confirmDiscard ヘルパーを追加**

`create<AppState>((set, get) => {` の直後、`function setTabRunning` の前に追加:

```ts
  // 未コミットの変更があるとき、ナビゲーション前に破棄してよいか確認する。
  function confirmDiscard(tab: TableTab): boolean {
    if (Object.keys(tab.edits).length === 0) return true
    return window.confirm('未コミットの変更があります。破棄して移動しますか？')
  }
```

- [ ] **Step 6: selectTable で主キーを取得**

`async selectTable(name) { ... }` を次に置き換え:

```ts
    async selectTable(name) {
      const existing = get().tabs.find(
        (t): t is TableTab => t.kind === 'table' && t.tableName === name
      )
      if (existing) {
        set({ activeTabId: existing.id })
        return
      }
      const tab = makeTableTab(name)
      set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
      const pk = await window.api.primaryKey(name)
      patchTableTab(tab.id, (t) => ({ ...t, primaryKey: pk.ok ? pk.data : [] }))
      await runTable(tab.id, { recount: true })
    },
```

- [ ] **Step 7: ナビゲーション系アクションにガード + edits クリアを追加**

`async applyFilters(tabId) { ... }` から末尾の `async setPageSize(...) { ... }` までの4アクションを、次の4アクションで置き換え:

```ts
    async applyFilters(tabId) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({ ...t, page: 0, edits: {}, editError: null }))
      await runTable(tabId, { recount: true })
    },

    async setSort(tabId, column) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({
        ...t,
        sort: cycleSort(t.sort, column),
        page: 0,
        edits: {},
        editError: null
      }))
      await runTable(tabId, { recount: false })
    },

    async setPage(tabId, page) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({ ...t, page: Math.max(0, page), edits: {}, editError: null }))
      await runTable(tabId, { recount: false })
    },

    async setPageSize(tabId, size) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      const safe = [50, 100, 500].includes(size) ? size : 100
      patchTableTab(tabId, (t) => ({ ...t, pageSize: safe, page: 0, edits: {}, editError: null }))
      await runTable(tabId, { recount: false })
    },

    setCellEdit(tabId, row, column, value) {
      patchTableTab(tabId, (t) => {
        if (t.primaryKey.length === 0) return t
        const key = rowKeyOf(t.primaryKey, row)
        const existing = t.edits[key] ?? { pk: pkValuesOf(t.primaryKey, row), values: {} }
        const values = { ...existing.values }
        const original = row[column]
        // オリジナルと同じ値なら変更扱いしない（ハイライト解除）
        if (original !== null && original !== undefined && String(original) === value) {
          delete values[column]
        } else {
          values[column] = value
        }
        const edits = { ...t.edits }
        if (Object.keys(values).length === 0) delete edits[key]
        else edits[key] = { pk: existing.pk, values }
        return { ...t, edits, editError: null }
      })
    },

    setCellNull(tabId, row, column) {
      patchTableTab(tabId, (t) => {
        if (t.primaryKey.length === 0) return t
        const key = rowKeyOf(t.primaryKey, row)
        const existing = t.edits[key] ?? { pk: pkValuesOf(t.primaryKey, row), values: {} }
        const values = { ...existing.values }
        // すでに NULL なら変更扱いしない
        if (row[column] === null) delete values[column]
        else values[column] = null
        const edits = { ...t.edits }
        if (Object.keys(values).length === 0) delete edits[key]
        else edits[key] = { pk: existing.pk, values }
        return { ...t, edits, editError: null }
      })
    },

    discardEdits(tabId) {
      patchTableTab(tabId, (t) => ({ ...t, edits: {}, editError: null }))
    },

    async commitEdits(tabId) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || tab.running || Object.keys(tab.edits).length === 0) return
      const statements = buildUpdateStatements(tab.tableName, tab.primaryKey, Object.values(tab.edits))
      if (statements.length === 0) return
      setTabRunning(tabId)
      try {
        const res = await window.api.applyChanges(statements)
        if (!res.ok) {
          // 失敗時はグリッドを潰さず EditBar にエラー表示。ステージは保持して再試行可能。
          set({
            tabs: get().tabs.map((t) =>
              t.id === tabId && t.kind === 'table'
                ? { ...t, running: false, editError: res.error }
                : t
            )
          })
          return
        }
        patchTableTab(tabId, (t) => ({ ...t, edits: {}, editError: null }))
        await runTable(tabId, { recount: false })
      } catch (err) {
        failTab(tabId, err)
      }
    }
```

注意: 置き換え対象は元の `applyFilters` / `setSort` / `setPage` / `setPageSize` の4アクション。`setPageSize` は元々オブジェクトの末尾プロパティなので、置き換え後の末尾は `commitEdits`（末尾カンマ不要）になるようにする。`clearFilters` は変更しない。

- [ ] **Step 8: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 9: 既存ユニットが緑であることを確認**

Run: `npm test`
Expected: 全ユニット PASS（結合 skip）

- [ ] **Step 10: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: TableTab に primaryKey/edits/editError を追加し編集アクションを実装

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: ResultsGrid のセル編集 UI

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

- [ ] **Step 1: ResultsGrid.tsx を全置換**

```tsx
import { useMemo, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import type { QueryResult, TableSort, RowEdit } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { rowKeyOf } from '../store/rowKey'
import styles from './ResultsGrid.module.css'

type Row = Record<string, unknown>

export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setSort = useAppStore((s) => s.setSort)
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)

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

  const isTable = tab.kind === 'table'
  const sort = isTable ? tab.sort : null
  const onSort = isTable ? (column: string): void => void setSort(tab.id, column) : undefined
  // 編集はテーブルタブ かつ 主キーありのときのみ
  const editable = isTable && tab.primaryKey.length > 0
  const primaryKey = isTable ? tab.primaryKey : []
  const edits = isTable ? tab.edits : {}

  return (
    <Grid
      result={tab.result}
      sort={sort}
      onSort={onSort}
      editable={editable}
      primaryKey={primaryKey}
      edits={edits}
      onEdit={editable ? (row, col, val) => setCellEdit(tab.id, row, col, val) : undefined}
      onNull={editable ? (row, col) => setCellNull(tab.id, row, col) : undefined}
    />
  )
}

function Grid({
  result,
  sort,
  onSort,
  editable,
  primaryKey,
  edits,
  onEdit,
  onNull
}: {
  result: QueryResult
  sort: TableSort | null
  onSort?: (column: string) => void
  editable: boolean
  primaryKey: string[]
  edits: Record<string, RowEdit>
  onEdit?: (row: Row, column: string, value: string) => void
  onNull?: (row: Row, column: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState<{ rowKey: string; column: string } | null>(null)
  const [draft, setDraft] = useState('')

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
              {hg.headers.map((h) => {
                const name = h.column.id
                const active = sort?.column === name
                return (
                  <th
                    key={h.id}
                    className={onSort ? styles.sortable : undefined}
                    onClick={onSort ? () => onSort(name) : undefined}
                  >
                    {primaryKey.includes(name) && <span className={styles.pkIcon}>🔑 </span>}
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {active && (
                      <span className={styles.sortInd}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => {
            const original = r.original as Row
            const rowKey = editable ? rowKeyOf(primaryKey, original) : ''
            const rowEdit = editable ? edits[rowKey] : undefined
            return (
              <tr key={r.id}>
                {r.getVisibleCells().map((cell) => {
                  const colId = cell.column.id
                  const isDirty = rowEdit ? colId in rowEdit.values : false
                  const value = isDirty ? rowEdit!.values[colId] : (cell.getValue() as unknown)
                  const isEditingThis = editing?.rowKey === rowKey && editing?.column === colId

                  const startEdit = (): void => {
                    if (!editable) return
                    setEditing({ rowKey, column: colId })
                    setDraft(value === null || value === undefined ? '' : String(value))
                  }
                  const confirm = (): void => {
                    onEdit?.(original, colId, draft)
                    setEditing(null)
                  }
                  const cancel = (): void => setEditing(null)
                  const setNull = (): void => {
                    onNull?.(original, colId)
                    setEditing(null)
                  }

                  const cls =
                    [isDirty ? styles.dirty : '', isEditingThis ? styles.editing : '']
                      .filter(Boolean)
                      .join(' ') || undefined

                  return (
                    <td key={cell.id} className={cls} onDoubleClick={editable ? startEdit : undefined}>
                      {isEditingThis ? (
                        <span className={styles.editWrap}>
                          <input
                            autoFocus
                            className={styles.editInput}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirm()
                              else if (e.key === 'Escape') cancel()
                            }}
                            onBlur={confirm}
                          />
                          <button
                            className={styles.nullBtn}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setNull()
                            }}
                          >
                            NULL
                          </button>
                        </span>
                      ) : value === null || value === undefined ? (
                        <span className={styles.null}>NULL</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: ResultsGrid.module.css に編集用スタイルを追記**

ファイル末尾に追加:

```css
.pkIcon {
  font-size: 10px;
  opacity: 0.8;
}
.dirty {
  background: #fff3cd !important;
  box-shadow: inset 0 0 0 1px #ffcf33;
}
.editing {
  background: #fff !important;
  box-shadow: inset 0 0 0 2px #2f7bf6;
  padding: 2px 8px;
}
.editWrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.editInput {
  font: inherit;
  border: none;
  outline: none;
  min-width: 80px;
  background: transparent;
  color: inherit;
}
.nullBtn {
  font-size: 9px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-sidebar);
  color: var(--text-muted);
  cursor: pointer;
}
```

- [ ] **Step 3: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: 結果グリッドのセルをインライン編集可能に（変更ハイライト/NULL/主キー表示）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: EditBar（コミットバー）+ WorkspaceShell 配線

**Files:**
- Create: `src/renderer/src/workspace/EditBar.tsx`
- Create: `src/renderer/src/workspace/EditBar.module.css`
- Modify: `src/renderer/src/workspace/WorkspaceShell.tsx`

- [ ] **Step 1: EditBar.tsx を新規作成**

```tsx
import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import styles from './EditBar.module.css'

export default function EditBar(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const commitEdits = useAppStore((s) => s.commitEdits)
  const discardEdits = useAppStore((s) => s.discardEdits)

  const editCount = tab
    ? Object.values(tab.edits).reduce((n, e) => n + Object.keys(e.values).length, 0)
    : 0
  const rowCount = tab ? Object.keys(tab.edits).length : 0
  const tabId = tab?.id

  // ⌘S / Ctrl+S でコミット（変更がある間だけ購読）。running 中の二重実行は commitEdits 側で防ぐ。
  useEffect(() => {
    if (!tabId || editCount === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void commitEdits(tabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabId, editCount, commitEdits])

  if (!tab || editCount === 0) return null

  return (
    <div className={styles.bar}>
      <span className={styles.count}>
        ● 未コミットの変更: {editCount} 件（{rowCount} 行）
      </span>
      {tab.editError && (
        <span className={styles.err}>
          {tab.editError.code}: {tab.editError.message}
        </span>
      )}
      <span className={styles.spacer} />
      <button className={styles.discard} disabled={tab.running} onClick={() => discardEdits(tab.id)}>
        破棄
      </button>
      <button
        className={styles.commit}
        disabled={tab.running}
        onClick={() => void commitEdits(tab.id)}
      >
        コミット ⌘S
      </button>
    </div>
  )
}
```

- [ ] **Step 2: EditBar.module.css を新規作成**

```css
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  padding: 4px 12px;
  background: #fff8e1;
  border-top: 1px solid #ffe08a;
  font-size: 11px;
  color: #7a5b00;
  flex-shrink: 0;
}
.count {
  font-weight: 600;
}
.err {
  color: #b91c1c;
}
.spacer {
  flex: 1;
}
.bar button {
  font-size: 11px;
  padding: 3px 12px;
  border-radius: 6px;
  border: 1px solid #d8d8dc;
  background: #fff;
  cursor: pointer;
}
.bar button:disabled {
  opacity: 0.5;
  cursor: default;
}
.commit {
  background: #2f7bf6 !important;
  border-color: #2f7bf6 !important;
  color: #fff;
}
```

- [ ] **Step 3: WorkspaceShell.tsx に EditBar を配線（全置換）**

```tsx
import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
import EditBar from './EditBar'
import Pager from './Pager'
import StatusBar from './StatusBar'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
  const activeKind = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t?.kind ?? null
  })

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.mainCol}>
        <TabBar />
        {activeKind === null ? (
          <div className={styles.empty}>
            左のテーブルを選ぶか「＋」でクエリタブを開いてください
          </div>
        ) : (
          <>
            {activeKind === 'table' ? <FilterBar /> : <QueryEditor />}
            <ResultsGrid />
            {activeKind === 'table' && <EditBar />}
            {activeKind === 'table' && <Pager />}
            <StatusBar />
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/EditBar.tsx src/renderer/src/workspace/EditBar.module.css src/renderer/src/workspace/WorkspaceShell.tsx
git commit -m "feat: コミットバー EditBar（破棄/コミット ⌘S）を追加し配線

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完了後の最終確認

- [ ] `npm run typecheck` — エラーなし
- [ ] `npm test` — 全ユニット PASS（結合 skip）
- [ ] `npm run build` — `✓ built`
- [ ] （任意）docker MySQL で結合テスト: `TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts`
- [ ] 手動確認（`npm run dev` を完全再起動 → 接続し直し。**main/preload を変更したため再起動必須**）:
  - 主キーありテーブル: ヘッダに 🔑、セルをダブルクリックで編集 → Enter で確定（黄色ハイライト）
  - NULL ボタンで NULL に設定、オリジナルと同じ値に戻すとハイライト解除
  - EditBar に件数表示、⌘S または「コミット」で反映 → グリッド再取得でハイライト消える
  - 破棄で変更が消える
  - 主キーなしテーブル: セルが編集できない（🔑 なし）
  - 未コミットでページ送り/ソート/フィルタ適用 → 確認ダイアログ
  - コミット失敗（例: NOT NULL 列に NULL）時に EditBar にエラー表示、ステージ保持

> **注:** main/preload を変更したため、`npm run dev` は完全停止 → 再起動が必須。

---

## 既知の制約（spec §6 より）

- UNIQUE キーのみ（PK なし）のテーブルは読み取り専用（将来対応の余地）。
- 編集はカレントページ単位。ページ移動・ソート・フィルタ・再取得で未コミット分は破棄（移動時に `confirm` 確認）。
- 値入力は文字列ベース。mysql2 が列型に変換。NULL は「NULL」ボタンで明示設定。
