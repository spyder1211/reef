# テーブルビュー閲覧体験強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルビュー（TableTab）に、サーバーサイドの列ソート・ページサイズ可変＋ページ送り・総件数表示を追加する。

**Architecture:** クエリ組み立て（`filterBuilder.ts`）に `ORDER BY`/`LIMIT`/`OFFSET` と `COUNT(*)` を追加し、ページ計算の純粋関数（`pager.ts`）に切り出してユニットテスト可能にする。Zustand ストア（`useAppStore.ts`）の `TableTab` に `sort`/`page`/`pageSize`/`total` を持たせ、`runTable(tabId, {recount})` で再実行を制御。UI は `ResultsGrid` のヘッダをソート可能化し、新規 `Pager` をテーブルタブのときだけ表示する。新規 IPC は不要（既存 `window.api.query` を流用）。

**Tech Stack:** Electron + React 18 + TypeScript / Zustand / @tanstack/react-table / mysql2 / Vitest / CSS Modules

**Spec:** `docs/superpowers/specs/2026-06-07-table-browsing-enhancements-design.md`

---

## File Structure

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/shared/types.ts` | 変更 | `SortDir` / `TableSort` 型を追加（main/preload/renderer 共有） |
| `src/renderer/src/store/filterBuilder.ts` | 変更 | `buildWhere` 切り出し、`buildFilteredQuery` に sort/limit/offset、`buildCountQuery` 追加 |
| `src/renderer/src/store/filterBuilder.test.ts` | 変更 | sort/limit/offset/count のユニットテストを追記 |
| `src/renderer/src/store/pager.ts` | 新規 | `totalPages` / `pageRange` / `canGoNext` / `cycleSort`（純粋関数） |
| `src/renderer/src/store/pager.test.ts` | 新規 | `pager.ts` の純粋関数ユニットテスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | `TableTab` 拡張、`runTable` 拡張、`setSort`/`setPage`/`setPageSize` 追加 |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | ソート可能ヘッダ + 指標表示（テーブルタブのみ） |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | ソート可能ヘッダのスタイル |
| `src/renderer/src/workspace/Pager.tsx` | 新規 | ページャ UI |
| `src/renderer/src/workspace/Pager.module.css` | 新規 | ページャのスタイル |
| `src/renderer/src/workspace/WorkspaceShell.tsx` | 変更 | テーブルタブで `Pager` を描画 |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | ORDER BY+LIMIT/OFFSET と COUNT の結合テスト追加（gated） |

---

## Task 1: 共有型 + filterBuilder 拡張（sort / limit / offset / count）

**Files:**
- Modify: `src/shared/types.ts`（末尾に型追加）
- Modify: `src/renderer/src/store/filterBuilder.ts`
- Test: `src/renderer/src/store/filterBuilder.test.ts`（追記）

- [ ] **Step 1: 共有型を追加**

`src/shared/types.ts` の末尾（`FilterCondition` 定義の後）に追加:

```ts

// テーブルビューのソート状態
export type SortDir = 'asc' | 'desc'
export interface TableSort {
  column: string
  dir: SortDir
}
```

- [ ] **Step 2: 失敗するテストを追記**

`src/renderer/src/store/filterBuilder.test.ts` の `import` 行を次に置き換え:

```ts
import { describe, it, expect } from 'vitest'
import { buildFilteredQuery, buildCountQuery } from './filterBuilder'
import type { FilterCondition } from '../../../shared/types'
```

そして既存の `describe('buildFilteredQuery', ...)` ブロックの**閉じ括弧 `})` の直後**（ファイル末尾）に以下を追記:

```ts

describe('buildFilteredQuery options (sort/limit/offset)', () => {
  it('sort を渡すと ORDER BY を付ける（asc）', () => {
    const r = buildFilteredQuery('t', cols, [], { sort: { column: 'name', dir: 'asc' } })
    expect(r.sql).toBe('SELECT * FROM `t` ORDER BY `name` ASC LIMIT 100')
  })

  it('sort desc は ORDER BY ... DESC', () => {
    const r = buildFilteredQuery('t', cols, [], { sort: { column: 'date', dir: 'desc' } })
    expect(r.sql).toBe('SELECT * FROM `t` ORDER BY `date` DESC LIMIT 100')
  })

  it('ホワイトリスト外のソート列は ORDER BY を付けない', () => {
    const r = buildFilteredQuery('t', cols, [], { sort: { column: 'evil', dir: 'asc' } })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('ソート列の識別子をバッククォートでエスケープ', () => {
    const r = buildFilteredQuery('t', ['c`ol'], [], { sort: { column: 'c`ol', dir: 'asc' } })
    expect(r.sql).toBe('SELECT * FROM `t` ORDER BY `c``ol` ASC LIMIT 100')
  })

  it('limit を反映する', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 50 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 50')
  })

  it('offset > 0 のとき OFFSET を付ける', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 100, offset: 200 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100 OFFSET 200')
  })

  it('offset 0 のときは OFFSET を付けない', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 100, offset: 0 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('limit/offset が整数でなければ既定値にフォールバック', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: 1.5, offset: -3 })
    expect(r.sql).toBe('SELECT * FROM `t` LIMIT 100')
  })

  it('WHERE + ORDER BY + LIMIT + OFFSET の順で結合する', () => {
    const r = buildFilteredQuery(
      't',
      cols,
      [{ id: 'x', enabled: true, value: '5', value2: '', column: 'id', operator: '=' }],
      { sort: { column: 'name', dir: 'asc' }, limit: 100, offset: 100 }
    )
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? ORDER BY `name` ASC LIMIT 100 OFFSET 100')
    expect(r.params).toEqual(['5'])
  })
})

describe('buildCountQuery', () => {
  it('フィルタなしは素の COUNT', () => {
    expect(buildCountQuery('t', cols, [])).toEqual({
      sql: 'SELECT COUNT(*) AS total FROM `t`',
      params: []
    })
  })

  it('WHERE 付きで params が一致する', () => {
    const r = buildCountQuery('t', cols, [
      { id: 'x', enabled: true, value: '5', value2: '', column: 'id', operator: '=' }
    ])
    expect(r.sql).toBe('SELECT COUNT(*) AS total FROM `t` WHERE `id` = ?')
    expect(r.params).toEqual(['5'])
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/filterBuilder.test.ts`
Expected: FAIL（`buildCountQuery` が未エクスポート、`options` が未対応で ORDER BY/OFFSET が出ない）

- [ ] **Step 4: filterBuilder.ts を実装**

`src/renderer/src/store/filterBuilder.ts` を全置換:

```ts
import type { FilterCondition, TableSort } from '../../../shared/types'

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

function inItems(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// LIKE のメタ文字（% _ とエスケープ文字 \）を打ち消し、ユーザー入力を「リテラルとして含む」検索にする。
// MySQL 既定のエスケープ文字は \ なので ESCAPE 句は不要。
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

// SQL に直接埋め込む比較演算子の許可リスト（型システムを回避したキャストへの実行時防御）
const COMPARISON_OPS: ReadonlySet<string> = new Set(['=', '<>', '<', '>', '<=', '>='])

function isUsable(c: FilterCondition, columns: string[]): boolean {
  if (!c.enabled) return false
  if (!columns.includes(c.column)) return false
  switch (c.operator) {
    case 'is_null':
    case 'is_not_null':
      return true
    case 'between':
      return c.value.trim() !== '' && c.value2.trim() !== ''
    case 'in':
      return inItems(c.value).length > 0
    default:
      return c.value.trim() !== ''
  }
}

function clauseFor(c: FilterCondition): { clause: string; params: unknown[] } {
  const col = quoteIdent(c.column)
  switch (c.operator) {
    case 'is_null':
      return { clause: `${col} IS NULL`, params: [] }
    case 'is_not_null':
      return { clause: `${col} IS NOT NULL`, params: [] }
    case 'contains':
      return { clause: `${col} LIKE ?`, params: [`%${escapeLike(c.value)}%`] }
    case 'not_contains':
      return { clause: `${col} NOT LIKE ?`, params: [`%${escapeLike(c.value)}%`] }
    case 'in': {
      const items = inItems(c.value)
      return { clause: `${col} IN (${items.map(() => '?').join(', ')})`, params: items }
    }
    case 'between':
      return { clause: `${col} BETWEEN ? AND ?`, params: [c.value, c.value2] }
    default:
      // '=', '<>', '<', '>', '<=', '>='。演算子は SQL に直接埋め込むため許可リストで実行時検証する。
      if (!COMPARISON_OPS.has(c.operator)) {
        throw new Error(`Unexpected filter operator: ${c.operator}`)
      }
      return { clause: `${col} ${c.operator} ?`, params: [c.value] }
  }
}

// WHERE 句と params を生成（ページ用クエリと COUNT クエリで共有）。
function buildWhere(
  columns: string[],
  conditions: FilterCondition[]
): { where: string; params: unknown[] } {
  const parts = conditions.filter((c) => isUsable(c, columns)).map(clauseFor)
  const where = parts.map((p) => p.clause).join(' AND ')
  const params = parts.flatMap((p) => p.params)
  return { where, params }
}

// LIMIT/OFFSET を SQL に直接埋め込むためのガード（非負整数のみ受理し、それ以外は fallback）。
function safeInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

// ORDER BY 句を生成。sort が null かカラムがホワイトリスト外なら空文字。
function orderByClause(columns: string[], sort?: TableSort | null): string {
  if (!sort || !columns.includes(sort.column)) return ''
  const dir = sort.dir === 'desc' ? 'DESC' : 'ASC'
  return `${quoteIdent(sort.column)} ${dir}`
}

export interface PageOptions {
  sort?: TableSort | null
  limit?: number
  offset?: number
}

/**
 * フィルター条件からパラメータ化された SELECT を組み立てる。値は必ず `?` プレースホルダに入り、
 * 識別子（table/column）はバッククォートで囲み内部のバッククォートを2重化してエスケープする。
 * sort 列はカラム・ホワイトリストで検証し、limit/offset は非負整数のみ埋め込む。
 * @param table スキーマ由来の信頼できるテーブル名（ユーザー入力をそのまま渡さないこと）。
 * @param columns フィルター/ソート可能なカラムのホワイトリスト。
 * @param options sort/limit/offset。省略時は ORDER BY なし・LIMIT 100・OFFSET なし。
 */
export function buildFilteredQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[],
  options?: PageOptions
): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(columns, conditions)
  const orderBy = orderByClause(columns, options?.sort)
  const limit = safeInt(options?.limit, 100)
  const offset = safeInt(options?.offset, 0)
  const sql =
    `SELECT * FROM ${quoteIdent(table)}` +
    (where ? ` WHERE ${where}` : '') +
    (orderBy ? ` ORDER BY ${orderBy}` : '') +
    ` LIMIT ${limit}` +
    (offset > 0 ? ` OFFSET ${offset}` : '')
  return { sql, params }
}

/**
 * 同じフィルター条件に対する総件数クエリ（ORDER BY / LIMIT は付けない）。params は WHERE と一致。
 */
export function buildCountQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[]
): { sql: string; params: unknown[] } {
  const { where, params } = buildWhere(columns, conditions)
  const sql =
    `SELECT COUNT(*) AS total FROM ${quoteIdent(table)}` + (where ? ` WHERE ${where}` : '')
  return { sql, params }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/filterBuilder.test.ts`
Expected: PASS（既存テスト含め全て緑。`SELECT * FROM \`t\` LIMIT 100` の既存挙動が維持される）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/shared/types.ts src/renderer/src/store/filterBuilder.ts src/renderer/src/store/filterBuilder.test.ts
git commit -m "feat: filterBuilder に sort/limit/offset と COUNT クエリを追加 (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ページ計算の純粋関数（pager.ts）

**Files:**
- Create: `src/renderer/src/store/pager.ts`
- Test: `src/renderer/src/store/pager.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/store/pager.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import { totalPages, pageRange, canGoNext, cycleSort } from './pager'

describe('totalPages', () => {
  it('total が null なら null', () => {
    expect(totalPages(null, 100)).toBeNull()
  })
  it('0 件でも 1 ページ', () => {
    expect(totalPages(0, 100)).toBe(1)
  })
  it('端数は切り上げ', () => {
    expect(totalPages(250, 100)).toBe(3)
    expect(totalPages(200, 100)).toBe(2)
  })
})

describe('pageRange', () => {
  it('1 ページ目', () => {
    expect(pageRange(0, 100, 100)).toEqual({ start: 1, end: 100 })
  })
  it('3 ページ目の端数', () => {
    expect(pageRange(2, 100, 45)).toEqual({ start: 201, end: 245 })
  })
  it('返却 0 件なら 0-0', () => {
    expect(pageRange(0, 100, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('canGoNext', () => {
  it('total ありで最終ページ手前は true', () => {
    expect(canGoNext(0, 100, 250, 100)).toBe(true)
  })
  it('total ありで最終ページは false', () => {
    expect(canGoNext(2, 100, 250, 50)).toBe(false)
  })
  it('total が null なら 返却==pageSize で判定', () => {
    expect(canGoNext(0, 100, null, 100)).toBe(true)
    expect(canGoNext(0, 100, null, 40)).toBe(false)
  })
})

describe('cycleSort', () => {
  it('別の列は昇順から始まる', () => {
    expect(cycleSort(null, 'a')).toEqual({ column: 'a', dir: 'asc' })
    expect(cycleSort({ column: 'b', dir: 'desc' }, 'a')).toEqual({ column: 'a', dir: 'asc' })
  })
  it('同じ列は 昇順 → 降順', () => {
    expect(cycleSort({ column: 'a', dir: 'asc' }, 'a')).toEqual({ column: 'a', dir: 'desc' })
  })
  it('同じ列の降順は解除（null）', () => {
    expect(cycleSort({ column: 'a', dir: 'desc' }, 'a')).toBeNull()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/pager.test.ts`
Expected: FAIL（`./pager` が存在しない）

- [ ] **Step 3: pager.ts を実装**

`src/renderer/src/store/pager.ts` を新規作成:

```ts
import type { TableSort } from '../../../shared/types'

// 総ページ数。total が null（COUNT 未取得/失敗）なら null。0 件でも最小 1 ページ。
export function totalPages(total: number | null, pageSize: number): number | null {
  if (total === null) return null
  if (total <= 0) return 1
  return Math.ceil(total / pageSize)
}

// 現在ページの表示範囲 {start, end}（1 始まり）。返却 0 件なら {0, 0}。
export function pageRange(
  page: number,
  pageSize: number,
  returned: number
): { start: number; end: number } {
  if (returned <= 0) return { start: 0, end: 0 }
  const start = page * pageSize + 1
  return { start, end: page * pageSize + returned }
}

// 「次へ」可否。total があれば最終ページ判定、なければ返却行数==pageSize で判定（劣化動作）。
export function canGoNext(
  page: number,
  pageSize: number,
  total: number | null,
  returned: number
): boolean {
  const pages = totalPages(total, pageSize)
  if (pages === null) return returned === pageSize
  return page + 1 < pages
}

// ヘッダクリック時のソート巡回:
//  別の列 → その列の昇順 / 同じ列の昇順 → 降順 / 同じ列の降順 → 解除(null)
export function cycleSort(current: TableSort | null, column: string): TableSort | null {
  if (!current || current.column !== column) return { column, dir: 'asc' }
  if (current.dir === 'asc') return { column, dir: 'desc' }
  return null
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/pager.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/store/pager.ts src/renderer/src/store/pager.test.ts
git commit -m "feat: ページ計算/ソート巡回の純粋関数 pager を追加 (TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ストア拡張（TableTab フィールド + runTable + アクション）

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

このタスクはストア結合のため、検証は型チェック + 後続 UI タスクで行う（既存コードベースもストアのユニットテストは持たず、純粋ロジックは Task 1/2 で網羅済み）。

- [ ] **Step 1: import を更新**

`src/renderer/src/store/useAppStore.ts` の先頭 import を次に置き換え:

```ts
import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult,
  FilterCondition,
  TableSort
} from '../../../shared/types'
import { buildFilteredQuery, buildCountQuery } from './filterBuilder'
import { pickNextActiveTabId } from './helpers'
import { cycleSort } from './pager'
```

- [ ] **Step 2: TableTab インターフェースを拡張**

`export interface TableTab extends BaseTab { ... }` を次に置き換え:

```ts
export interface TableTab extends BaseTab {
  kind: 'table'
  tableName: string
  columns: string[]
  filters: FilterCondition[]
  sort: TableSort | null // null = 自然順
  pageSize: number // 50 | 100 | 500（既定 100）
  page: number // 0 始まり（UI 表示は 1 始まり）
  total: number | null // COUNT(*) 由来。未取得は null
}
```

- [ ] **Step 3: makeTableTab を更新**

`function makeTableTab(name: string): TableTab { ... }` を次に置き換え:

```ts
function makeTableTab(name: string): TableTab {
  return {
    kind: 'table',
    id: genId(),
    tableName: name,
    columns: [],
    filters: [],
    sort: null,
    pageSize: 100,
    page: 0,
    total: null,
    result: null,
    error: null,
    // 開いた直後は初回クエリ実行中とみなし、結果ペインのプレースホルダ点滅を防ぐ
    running: true
  }
}
```

- [ ] **Step 4: AppState のアクション型を追加**

`interface AppState { ... }` 内、`applyFilters: (tabId: string) => Promise<void>` の行の直後に追加:

```ts
  setSort: (tabId: string, column: string) => Promise<void>
  setPage: (tabId: string, page: number) => Promise<void>
  setPageSize: (tabId: string, size: number) => Promise<void>
```

- [ ] **Step 5: runTable を再実装**

既存の `async function runTable(tabId: string): Promise<void> { ... }` を次に置き換え:

```ts
  async function runTable(tabId: string, opts: { recount: boolean }): Promise<void> {
    const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
    if (!tab) return
    setTabRunning(tabId)
    try {
      const offset = tab.page * tab.pageSize
      const { sql, params } = buildFilteredQuery(tab.tableName, tab.columns, tab.filters, {
        sort: tab.sort,
        limit: tab.pageSize,
        offset
      })
      const res = await window.api.query(sql, params)

      // 件数はフィルタ/テーブル変更時のみ取り直す（ソート・ページ送りでは不変）。
      // ページクエリが失敗したときは COUNT を打たず、直前の total を維持する。
      let total = tab.total
      if (opts.recount && res.ok) {
        const c = buildCountQuery(tab.tableName, tab.columns, tab.filters)
        const cres = await window.api.query(c.sql, c.params)
        total = cres.ok ? Number(cres.data.rows[0]?.total ?? 0) : null
      }

      set({
        tabs: get().tabs.map((t) => {
          if (t.id !== tabId || t.kind !== 'table') return t
          if (!res.ok) return { ...t, running: false, result: null, error: res.error, total }
          const columns = t.columns.length > 0 ? t.columns : res.data.columns.map((col) => col.name)
          return { ...t, running: false, result: res.data, error: null, columns, total }
        })
      })
    } catch (err) {
      failTab(tabId, err)
    }
  }
```

- [ ] **Step 6: runActiveTab / selectTable / applyFilters を更新し、新アクションを追加**

`async runActiveTab() { ... }` を次に置き換え:

```ts
    async runActiveTab() {
      const tab = get().tabs.find((t) => t.id === get().activeTabId)
      if (!tab) return
      if (tab.kind === 'sql') await runSql(tab.id, tab.sql)
      else await runTable(tab.id, { recount: true })
    },
```

`async selectTable(name) { ... }` 内の末尾 `await runTable(tab.id)` を次に置き換え:

```ts
      await runTable(tab.id, { recount: true })
```

`async applyFilters(tabId) { await runTable(tabId) }` を次に置き換え:

```ts
    async applyFilters(tabId) {
      patchTableTab(tabId, (t) => ({ ...t, page: 0 }))
      await runTable(tabId, { recount: true })
    },

    async setSort(tabId, column) {
      patchTableTab(tabId, (t) => ({ ...t, sort: cycleSort(t.sort, column), page: 0 }))
      await runTable(tabId, { recount: false })
    },

    async setPage(tabId, page) {
      patchTableTab(tabId, (t) => ({ ...t, page: Math.max(0, page) }))
      await runTable(tabId, { recount: false })
    },

    async setPageSize(tabId, size) {
      patchTableTab(tabId, (t) => ({ ...t, pageSize: size, page: 0 }))
      await runTable(tabId, { recount: false })
    }
```

注: `clearFilters` は変更しない（フィルターを空にするだけ。FilterBar が直後に `applyFilters` を呼び、そこで page=0 + recount が走る）。`applyFilters` の後ろに `,` を付けて新アクションを続ける点に注意（オブジェクト末尾の `setPageSize` には `,` 不要）。

- [ ] **Step 7: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 8: 既存テストが壊れていないことを確認**

Run: `npm test`
Expected: 全ユニットテスト PASS（結合テストは TEST_MYSQL_HOST 未設定で skip）

- [ ] **Step 9: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: TableTab に sort/page/pageSize/total を追加し runTable を recount 対応に

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: ResultsGrid をソート可能化

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

- [ ] **Step 1: ResultsGrid.tsx を全置換**

```tsx
import { useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import type { QueryResult, TableSort } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import styles from './ResultsGrid.module.css'

type Row = Record<string, unknown>

export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setSort = useAppStore((s) => s.setSort)

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

  // テーブルタブだけ列ヘッダのソートを有効化（SQL タブはユーザーの SQL を書き換えない）。
  const sort = tab.kind === 'table' ? tab.sort : null
  const onSort =
    tab.kind === 'table' ? (column: string): void => void setSort(tab.id, column) : undefined

  return <Grid result={tab.result} sort={sort} onSort={onSort} />
}

function Grid({
  result,
  sort,
  onSort
}: {
  result: QueryResult
  sort: TableSort | null
  onSort?: (column: string) => void
}): JSX.Element {
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

- [ ] **Step 2: ResultsGrid.module.css にソート用スタイルを追記**

ファイル末尾に追加:

```css
.sortable {
  cursor: pointer;
  user-select: none;
}
.sortable:hover {
  color: var(--text);
}
.sortInd {
  margin-left: 4px;
  font-size: 10px;
}
```

- [ ] **Step 3: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built` で終了

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: 結果グリッドの列ヘッダクリックでサーバーサイドソート

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Pager コンポーネント + WorkspaceShell 配線

**Files:**
- Create: `src/renderer/src/workspace/Pager.tsx`
- Create: `src/renderer/src/workspace/Pager.module.css`
- Modify: `src/renderer/src/workspace/WorkspaceShell.tsx`

- [ ] **Step 1: Pager.tsx を新規作成**

```tsx
import { useAppStore } from '../store/useAppStore'
import { totalPages, pageRange, canGoNext } from '../store/pager'
import styles from './Pager.module.css'

const PAGE_SIZES = [50, 100, 500]

export default function Pager(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const setPage = useAppStore((s) => s.setPage)
  const setPageSize = useAppStore((s) => s.setPageSize)

  if (!tab) return null

  const returned = tab.result?.rows.length ?? 0
  const pages = totalPages(tab.total, tab.pageSize)
  const { start, end } = pageRange(tab.page, tab.pageSize, returned)
  const prevOk = tab.page > 0 && !tab.running
  const nextOk = canGoNext(tab.page, tab.pageSize, tab.total, returned) && !tab.running

  return (
    <div className={styles.pager}>
      <label className={styles.size}>
        ページサイズ
        <select
          value={tab.pageSize}
          disabled={tab.running}
          onChange={(e) => void setPageSize(tab.id, Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.nav}>
        <button disabled={!prevOk} onClick={() => void setPage(tab.id, tab.page - 1)}>
          ◀ 前へ
        </button>
        <span className={styles.pageNo}>
          ページ {tab.page + 1} / {pages ?? '?'}
        </span>
        <button disabled={!nextOk} onClick={() => void setPage(tab.id, tab.page + 1)}>
          次へ ▶
        </button>
      </div>

      <div className={styles.range}>
        {tab.total !== null
          ? `${start}–${end} / ${tab.total.toLocaleString()} 行`
          : `${start}–${end} 行目`}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Pager.module.css を新規作成**

```css
.pager {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 32px;
  padding: 0 12px;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.size {
  display: flex;
  align-items: center;
  gap: 6px;
}
.size select {
  font-size: 11px;
}
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.nav button {
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
}
.nav button:disabled {
  opacity: 0.4;
  cursor: default;
}
.pageNo {
  min-width: 96px;
  text-align: center;
}
.range {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: WorkspaceShell.tsx に Pager を配線（全置換）**

```tsx
import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
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
Expected: エラーなし、`✓ built` で終了

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/Pager.tsx src/renderer/src/workspace/Pager.module.css src/renderer/src/workspace/WorkspaceShell.tsx
git commit -m "feat: ページャ UI（ページサイズ可変+ページ送り+総件数）を追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 結合テスト（ORDER BY + LIMIT/OFFSET + COUNT）

**Files:**
- Modify: `src/main/connection/ConnectionManager.integration.test.ts`

このテストは `TEST_MYSQL_HOST` 未設定では skip される。実行するには docker MySQL を起動: `docker compose -f docker-compose.test.yml up -d` の上で `TEST_MYSQL_HOST=127.0.0.1 npm test`。

- [ ] **Step 1: 結合テストを追記**

`src/main/connection/ConnectionManager.integration.test.ts` の最後の `it('dateStrings: ...')` ブロックの**閉じ括弧 `})` の直後**（`describe` を閉じる `})` の直前）に追加:

```ts

  it('ORDER BY + LIMIT/OFFSET と COUNT(*) がページング用に正しく動く', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS pg_demo (id INT, n INT)')
    await mgr.query('DELETE FROM pg_demo')
    await mgr.query('INSERT INTO pg_demo (id, n) VALUES (1,10),(2,20),(3,30),(4,40),(5,50)')

    // n 降順 = 50,40,30,20,10。2 ページ目（OFFSET 2 LIMIT 2）→ 30,20
    const page = await mgr.query('SELECT n FROM `pg_demo` ORDER BY `n` DESC LIMIT 2 OFFSET 2')
    expect(page.rows.map((r) => r.n)).toEqual([30, 20])

    const count = await mgr.query('SELECT COUNT(*) AS total FROM `pg_demo`')
    expect(Number(count.rows[0].total)).toBe(5)
  })
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: 結合テストを実行（docker 起動済みの場合）**

Run: `docker compose -f docker-compose.test.yml up -d && TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts`
Expected: 7 tests PASS（新規 1 件含む）。docker が無い環境では skip でも可。

- [ ] **Step 4: コミット**

```bash
git add src/main/connection/ConnectionManager.integration.test.ts
git commit -m "test: ORDER BY+LIMIT/OFFSET と COUNT の結合テストを追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完了後の最終確認

全タスク完了後:

- [ ] `npm run typecheck` — エラーなし
- [ ] `npm test` — 全ユニットテスト PASS（結合は skip）
- [ ] `npm run build` — `✓ built`
- [ ] 手動確認（要 `npm run dev` の完全再起動 + 再接続。main/preload は変えていないが renderer を確実に反映するため）:
  - テーブルを開く → 「ページ 1 / N」「1–100 / 総件数」が出る
  - 列ヘッダクリックで ▲/▼ が付き並べ替わる、再クリックで降順→解除
  - ページサイズを 500 に変更 → 1 ページ目から再取得、件数表示が更新
  - 次へ/前へ でページ移動、最終ページで「次へ」が無効
  - フィルタ適用 → 1 ページ目に戻り総件数が更新される

> **注:** このスライスは renderer のみ変更（main/preload は不変）。`npm run dev` 起動中なら renderer は HMR されるが、確実を期すなら再起動推奨。

---

## 既知の制約（spec §6 より）

- ソート列に重複値があると OFFSET ページングで境界がぶれる可能性（主キーのタイブレーク未対応）。将来のテーブル構造ビュー機能で PK 取得後に改善余地。
- `total` は COUNT(*) のため巨大テーブルでは取得が重い場合あり。フィルタ変更時のみ実行して頻度を抑制。
