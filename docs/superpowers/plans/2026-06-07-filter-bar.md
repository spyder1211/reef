# フィルターバー（テーブルビュー）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルをクリックすると専用のテーブルビュー（フィルターバー＋結果グリッド）が開き、`[カラム][演算子][値]` の条件を複数行 AND で絞り込める機能を追加する。

**Architecture:** 既存の Workspace タブを判別共用体 `Tab = SqlTab | TableTab` に拡張。TableTab はフィルター条件を持ち、純関数 `buildFilteredQuery` が条件を**パラメータ化された** `{ sql, params }` に変換、`query(sql, params)` で安全に実行する。FilterBuilder のロジックは TDD で固める。

**Tech Stack:** Electron / TypeScript / React / Zustand / mysql2（`pool.query(sql, params)` のプレースホルダ）/ Vitest。

**設計書:** [`../specs/2026-06-07-filter-bar-design.md`](../specs/2026-06-07-filter-bar-design.md)

---

## 凡例・前提

- 作業ブランチを切ってから始める（main 直での実装は不可）: `git checkout -b feat/filter-bar`。
- テスト: `npx vitest run <path>`、型: `npm run typecheck`、ビルド: `npm run build`。`npm run dev` は対話的 Electron なので使わない（型チェック/ビルドで代替）。
- 既存パターン: IPC は `ApiResult<T>` を返す／Vitest は node 環境／CSS Modules ＋ `theme.css` のデザイントークン（`var(--...)`）／tsconfig は `jsx:react-jsx`・`strict:true`・`noUnusedLocals` 無効。
- 一意ID は `crypto.randomUUID()`。
- 各タスク末尾でコミット。コミットメッセージ末尾に必ず: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## Task 1: 共有型（FilterOperator / FilterCondition）

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 型を追記**

`src/shared/types.ts` の末尾に追加:

```ts
// フィルター条件
export type FilterOperator =
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | 'is_null' | 'is_not_null'
  | 'contains' | 'not_contains'
  | 'in' | 'between'

export interface FilterCondition {
  id: string
  enabled: boolean
  column: string
  operator: FilterOperator
  value: string // 主値（between は下限 / in はカンマ区切りリスト）
  value2: string // between の上限のみ使用
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/shared/types.ts
git commit -m "feat: 共有型に FilterCondition を追加"
```

---

## Task 2: クエリのパラメータ化（バックエンド）

`query` を `(sql, params?)` に拡張する。`params` 省略時は従来通り。

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`
- Modify: `src/main/ipc/registerDbHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: ConnectionManager.query を拡張**

`src/main/connection/ConnectionManager.ts` の `query` メソッドを次に置き換える:

```ts
  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const start = Date.now()
    const [rows, fields] = await this.pool.query(sql, params)
    const durationMs = Date.now() - start
    const dataRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    const columns = (fields ?? []).map((f) => ({ name: (f as { name: string }).name }))
    return { columns, rows: dataRows, rowCount: dataRows.length, durationMs }
  }
```

- [ ] **Step 2: db:query ハンドラを拡張**

`src/main/ipc/registerDbHandlers.ts` の `db:query` ハンドラを次に置き換える:

```ts
  ipcMain.handle(
    'db:query',
    async (_e, sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> => {
      try {
        return { ok: true, data: await manager.query(sql, params) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )
```

- [ ] **Step 3: preload を拡張**

`src/preload/index.ts` の `query` 行を次に置き換える:

```ts
  query: (sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:query', sql, params),
```

- [ ] **Step 4: env.d.ts を更新**

`src/renderer/src/env.d.ts` の `query` の行を次に置き換える:

```ts
      query: (sql: string, params?: unknown[]) => Promise<ApiResult<QueryResult>>
```

- [ ] **Step 5: 型チェック＆既存テスト**

Run: `npm run typecheck && npx vitest run`
Expected: PASS（既存テストは全て緑、integration は skip）

- [ ] **Step 6: コミット**

```bash
git add src/main/connection/ConnectionManager.ts src/main/ipc/registerDbHandlers.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: query をパラメータ化 (sql, params?) に拡張"
```

---

## Task 3: 演算子メタデータ（lib）

**Files:**
- Create: `src/renderer/src/lib/filterOperators.ts`

- [ ] **Step 1: 実装**

`src/renderer/src/lib/filterOperators.ts`:

```ts
import type { FilterOperator } from '../../../shared/types'

export type OperatorValueKind = 'none' | 'single' | 'two' | 'list'

export interface OperatorMeta {
  value: FilterOperator
  label: string
}

export const OPERATORS: OperatorMeta[] = [
  { value: '=', label: '=' },
  { value: '<>', label: '≠' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '<=', label: '≤' },
  { value: '>=', label: '≥' },
  { value: 'contains', label: '含む' },
  { value: 'not_contains', label: '含まない' },
  { value: 'in', label: 'IN' },
  { value: 'between', label: 'BETWEEN' },
  { value: 'is_null', label: 'IS NULL' },
  { value: 'is_not_null', label: 'IS NOT NULL' }
]

export const OPERATOR_VALUE_KIND: Record<FilterOperator, OperatorValueKind> = {
  '=': 'single',
  '<>': 'single',
  '<': 'single',
  '>': 'single',
  '<=': 'single',
  '>=': 'single',
  contains: 'single',
  not_contains: 'single',
  in: 'list',
  between: 'two',
  is_null: 'none',
  is_not_null: 'none'
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/lib/filterOperators.ts
git commit -m "feat: フィルター演算子メタデータを追加"
```

---

## Task 4: FilterBuilder（純関数）— TDD

**Files:**
- Create: `src/renderer/src/store/filterBuilder.ts`
- Test: `src/renderer/src/store/filterBuilder.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/store/filterBuilder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildFilteredQuery } from './filterBuilder'
import type { FilterCondition } from '../../../shared/types'

const cols = ['id', 'name', 'date']
const base: Omit<FilterCondition, 'column' | 'operator'> = {
  id: 'x',
  enabled: true,
  value: '',
  value2: ''
}

describe('buildFilteredQuery', () => {
  it('フィルタなしは素のSELECT', () => {
    expect(buildFilteredQuery('t', cols, [])).toEqual({
      sql: 'SELECT * FROM `t` LIMIT 100',
      params: []
    })
  })

  it('= は ? プレースホルダ', () => {
    const r = buildFilteredQuery('t', cols, [{ ...base, column: 'id', operator: '=', value: '5' }])
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? LIMIT 100')
    expect(r.params).toEqual(['5'])
  })

  it('含む は LIKE %v%', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'name', operator: 'contains', value: 'ab' }
    ])
    expect(r.sql).toContain('`name` LIKE ?')
    expect(r.params).toEqual(['%ab%'])
  })

  it('含まない は NOT LIKE', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'name', operator: 'not_contains', value: 'ab' }
    ])
    expect(r.sql).toContain('`name` NOT LIKE ?')
    expect(r.params).toEqual(['%ab%'])
  })

  it('IS NULL は値なし', () => {
    const r = buildFilteredQuery('t', cols, [{ ...base, column: 'name', operator: 'is_null' }])
    expect(r.sql).toContain('`name` IS NULL')
    expect(r.params).toEqual([])
  })

  it('IN はカンマ分割で複数 ?（空要素除去）', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'id', operator: 'in', value: '1, 2 , ,3' }
    ])
    expect(r.sql).toContain('`id` IN (?, ?, ?)')
    expect(r.params).toEqual(['1', '2', '3'])
  })

  it('BETWEEN は2つの ?', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'date', operator: 'between', value: 'a', value2: 'b' }
    ])
    expect(r.sql).toContain('`date` BETWEEN ? AND ?')
    expect(r.params).toEqual(['a', 'b'])
  })

  it('複数行は AND 結合', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'id', operator: '=', value: '1' },
      { ...base, column: 'name', operator: 'contains', value: 'x' }
    ])
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? AND `name` LIKE ? LIMIT 100')
    expect(r.params).toEqual(['1', '%x%'])
  })

  it('無効行/空値/未知カラム/値不足BETWEEN/空INはスキップ', () => {
    const r = buildFilteredQuery('t', cols, [
      { ...base, column: 'id', operator: '=', value: '1', enabled: false },
      { ...base, column: 'name', operator: '=', value: '' },
      { ...base, column: 'unknown', operator: '=', value: 'z' },
      { ...base, column: 'date', operator: 'between', value: 'a', value2: '' },
      { ...base, column: 'id', operator: 'in', value: ' , ' }
    ])
    expect(r).toEqual({ sql: 'SELECT * FROM `t` LIMIT 100', params: [] })
  })

  it('識別子のバッククォートを2重化してエスケープ', () => {
    const r = buildFilteredQuery('we`ird', ['c`ol'], [
      { ...base, column: 'c`ol', operator: 'is_null' }
    ])
    expect(r.sql).toBe('SELECT * FROM `we``ird` WHERE `c``ol` IS NULL LIMIT 100')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/filterBuilder.test.ts`
Expected: FAIL（未実装）

- [ ] **Step 3: 実装**

`src/renderer/src/store/filterBuilder.ts`:

```ts
import type { FilterCondition } from '../../../shared/types'

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

function inItems(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

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
      return { clause: `${col} LIKE ?`, params: [`%${c.value}%`] }
    case 'not_contains':
      return { clause: `${col} NOT LIKE ?`, params: [`%${c.value}%`] }
    case 'in': {
      const items = inItems(c.value)
      return { clause: `${col} IN (${items.map(() => '?').join(', ')})`, params: items }
    }
    case 'between':
      return { clause: `${col} BETWEEN ? AND ?`, params: [c.value, c.value2] }
    default:
      // '=', '<>', '<', '>', '<=', '>='
      return { clause: `${col} ${c.operator} ?`, params: [c.value] }
  }
}

export function buildFilteredQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[]
): { sql: string; params: unknown[] } {
  const parts = conditions.filter((c) => isUsable(c, columns)).map(clauseFor)
  const where = parts.map((p) => p.clause).join(' AND ')
  const params = parts.flatMap((p) => p.params)
  const sql = `SELECT * FROM ${quoteIdent(table)}` + (where ? ` WHERE ${where}` : '') + ` LIMIT 100`
  return { sql, params }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/filterBuilder.test.ts`
Expected: PASS（10件）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/store/filterBuilder.ts src/renderer/src/store/filterBuilder.test.ts
git commit -m "feat: FilterBuilder (条件→パラメータ化SQL) を追加 (TDD)"
```

---

## Task 5: ストアのタブ共用体化 ＋ フィルターアクション（QueryEditor / TabBar も追従）

タブを `SqlTab | TableTab` に拡張。この変更で `tab.sql` / `tab.title` を使う `QueryEditor` と `TabBar` が壊れるため、同じタスクで追従して**ビルドを緑に保つ**。`WorkspaceShell` への FilterBar 配線は Task 6。

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`（全置換）
- Modify: `src/renderer/src/workspace/QueryEditor.tsx`
- Modify: `src/renderer/src/workspace/TabBar.tsx`
- Modify: `src/renderer/src/workspace/TabBar.module.css`

- [ ] **Step 1: useAppStore を全置換**

`src/renderer/src/store/useAppStore.ts` を次の内容に置き換える:

```ts
import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult,
  FilterCondition
} from '../../../shared/types'
import { buildFilteredQuery } from './filterBuilder'
import { pickNextActiveTabId } from './helpers'

interface BaseTab {
  id: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
}
export interface SqlTab extends BaseTab {
  kind: 'sql'
  title: string
  sql: string
}
export interface TableTab extends BaseTab {
  kind: 'table'
  tableName: string
  columns: string[]
  filters: FilterCondition[]
}
export type Tab = SqlTab | TableTab

export type Status = 'idle' | 'connecting' | 'connected' | 'error'

function genId(): string {
  return crypto.randomUUID()
}

function makeSqlTab(index: number): SqlTab {
  return {
    kind: 'sql',
    id: genId(),
    title: `Query ${index}`,
    sql: 'SELECT 1 AS one;',
    result: null,
    error: null,
    running: false
  }
}

function makeTableTab(name: string): TableTab {
  return {
    kind: 'table',
    id: genId(),
    tableName: name,
    columns: [],
    filters: [],
    result: null,
    error: null,
    running: false
  }
}

function makeFilter(column: string): FilterCondition {
  return { id: genId(), enabled: true, column, operator: '=', value: '', value2: '' }
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
  addFilter: (tabId: string) => void
  removeFilter: (tabId: string, filterId: string) => void
  updateFilter: (tabId: string, filterId: string, patch: Partial<FilterCondition>) => void
  clearFilters: (tabId: string) => void
  applyFilters: (tabId: string) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => {
  async function runSql(tabId: string, sql: string, params?: unknown[]): Promise<void> {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: true, error: null } : t)) })
    const res = await window.api.query(sql, params)
    set({
      tabs: get().tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              running: false,
              result: res.ok ? res.data : null,
              error: res.ok ? null : res.error
            }
          : t
      )
    })
  }

  async function runTable(tabId: string): Promise<void> {
    const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
    if (!tab) return
    const { sql, params } = buildFilteredQuery(tab.tableName, tab.columns, tab.filters)
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: true, error: null } : t)) })
    const res = await window.api.query(sql, params)
    set({
      tabs: get().tabs.map((t) => {
        if (t.id !== tabId || t.kind !== 'table') return t
        if (!res.ok) return { ...t, running: false, result: null, error: res.error }
        const columns = t.columns.length > 0 ? t.columns : res.data.columns.map((c) => c.name)
        return { ...t, running: false, result: res.data, error: null, columns }
      })
    })
  }

  return {
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
      const tab = makeSqlTab(1)
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
      const tab = makeSqlTab(tabs.length + 1)
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
      set({ tabs: get().tabs.map((t) => (t.id === id && t.kind === 'sql' ? { ...t, sql } : t)) })
    },

    async runActiveTab() {
      const tab = get().tabs.find((t) => t.id === get().activeTabId)
      if (!tab) return
      if (tab.kind === 'sql') await runSql(tab.id, tab.sql)
      else await runTable(tab.id)
    },

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
      await runTable(tab.id)
    },

    addFilter(tabId) {
      set({
        tabs: get().tabs.map((t) => {
          if (t.id !== tabId || t.kind !== 'table') return t
          return { ...t, filters: [...t.filters, makeFilter(t.columns[0] ?? '')] }
        })
      })
    },

    removeFilter(tabId, filterId) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table'
            ? { ...t, filters: t.filters.filter((f) => f.id !== filterId) }
            : t
        )
      })
    },

    updateFilter(tabId, filterId, patch) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table'
            ? {
                ...t,
                filters: t.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f))
              }
            : t
        )
      })
    },

    clearFilters(tabId) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table' ? { ...t, filters: [] } : t
        )
      })
    },

    async applyFilters(tabId) {
      await runTable(tabId)
    }
  }
})
```

- [ ] **Step 2: QueryEditor を SqlTab 限定にする**

`src/renderer/src/workspace/QueryEditor.tsx` の、先頭の `activeTabId` / `tab` を取得する2行を次に置き換える:

```tsx
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'sql' ? t : null
  })
```

（以降の `if (!tab) return null` 以下はそのまま。これで `tab.sql` は SqlTab に絞られる。）

- [ ] **Step 3: TabBar をタブ種別対応にする**

`src/renderer/src/workspace/TabBar.tsx` の、各タブを描画する `<div ...>` 内の `<span className={styles.title}>{t.title}</span>` を次に置き換える:

```tsx
          <span className={styles.icon}>{t.kind === 'table' ? '▦' : '⚡'}</span>
          <span className={styles.title}>{t.kind === 'table' ? t.tableName : t.title}</span>
```

- [ ] **Step 4: TabBar の icon クラスを追加**

`src/renderer/src/workspace/TabBar.module.css` の末尾に追加:

```css
.icon {
  font-size: 10px;
  color: var(--text-faint);
}
```

- [ ] **Step 5: 型チェック＆テスト**

Run: `npm run typecheck && npx vitest run`
Expected: PASS（既存の helpers / filterBuilder テストも緑）

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts src/renderer/src/workspace/QueryEditor.tsx src/renderer/src/workspace/TabBar.tsx src/renderer/src/workspace/TabBar.module.css
git commit -m "feat: タブを SqlTab/TableTab の共用体化しフィルターアクションを追加"
```

---

## Task 6: FilterBar コンポーネント ＋ WorkspaceShell 配線

**Files:**
- Create: `src/renderer/src/workspace/FilterBar.tsx`
- Create: `src/renderer/src/workspace/FilterBar.module.css`
- Modify: `src/renderer/src/workspace/WorkspaceShell.tsx`

- [ ] **Step 1: FilterBar を実装**

`src/renderer/src/workspace/FilterBar.tsx`:

```tsx
import type { FilterOperator } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { buildFilteredQuery } from '../store/filterBuilder'
import { OPERATORS, OPERATOR_VALUE_KIND } from '../lib/filterOperators'
import styles from './FilterBar.module.css'

export default function FilterBar(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const addFilter = useAppStore((s) => s.addFilter)
  const removeFilter = useAppStore((s) => s.removeFilter)
  const updateFilter = useAppStore((s) => s.updateFilter)
  const clearFilters = useAppStore((s) => s.clearFilters)
  const applyFilters = useAppStore((s) => s.applyFilters)

  if (!tab) return null

  const preview = buildFilteredQuery(tab.tableName, tab.columns, tab.filters).sql

  return (
    <div className={styles.bar}>
      {tab.filters.length === 0 ? (
        <div className={styles.empty}>フィルターなし（先頭100行）</div>
      ) : (
        tab.filters.map((f) => {
          const valueKind = OPERATOR_VALUE_KIND[f.operator]
          return (
            <div key={f.id} className={styles.row}>
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => updateFilter(tab.id, f.id, { enabled: e.target.checked })}
              />
              <select
                className={styles.sel}
                value={f.column}
                onChange={(e) => updateFilter(tab.id, f.id, { column: e.target.value })}
              >
                {tab.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                className={styles.sel}
                value={f.operator}
                onChange={(e) =>
                  updateFilter(tab.id, f.id, { operator: e.target.value as FilterOperator })
                }
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {valueKind === 'none' ? (
                <span className={styles.val} />
              ) : valueKind === 'two' ? (
                <span className={styles.twoVals}>
                  <input
                    className={styles.val}
                    value={f.value}
                    placeholder="下限"
                    onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                  />
                  <span className={styles.tilde}>〜</span>
                  <input
                    className={styles.val}
                    value={f.value2}
                    placeholder="上限"
                    onChange={(e) => updateFilter(tab.id, f.id, { value2: e.target.value })}
                  />
                </span>
              ) : (
                <input
                  className={styles.val}
                  value={f.value}
                  placeholder={valueKind === 'list' ? 'カンマ区切り' : '値'}
                  onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyFilters(tab.id)
                  }}
                />
              )}
              <button className={styles.iconBtn} onClick={() => removeFilter(tab.id, f.id)} title="削除">
                −
              </button>
              <button className={styles.iconBtn} onClick={() => addFilter(tab.id)} title="条件を追加">
                ＋
              </button>
            </div>
          )
        })
      )}
      <div className={styles.footer}>
        <button className={styles.addBtn} onClick={() => addFilter(tab.id)}>
          ＋ 条件を追加
        </button>
        <div className={styles.spacer} />
        <button className={styles.clear} onClick={() => clearFilters(tab.id)}>
          Clear
        </button>
        <button className={styles.apply} onClick={() => void applyFilters(tab.id)}>
          Apply
        </button>
      </div>
      <div className={styles.preview} title={preview}>
        {preview}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: FilterBar の CSS**

`src/renderer/src/workspace/FilterBar.module.css`:

```css
.bar {
  flex-shrink: 0;
  background: #fbfbfd;
  border-bottom: 1px solid var(--border);
  padding: 8px 10px 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
.sel {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 12px;
  background: var(--bg);
  color: var(--text);
  outline: none;
}
.sel:focus {
  border-color: var(--accent);
}
.val {
  flex: 1;
  min-width: 60px;
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 7px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  outline: none;
}
.val:focus {
  border-color: var(--accent);
}
.twoVals {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tilde {
  color: var(--text-faint);
  font-size: 11px;
}
.iconBtn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
}
.iconBtn:hover {
  background: #e9e9ee;
}
.empty {
  font-size: 12px;
  color: var(--text-faint);
  padding: 2px 2px 6px;
}
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.spacer {
  flex: 1;
}
.addBtn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  padding: 2px 0;
}
.clear {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
}
.clear:hover {
  background: #e9e9ee;
}
.apply {
  border: none;
  background: var(--accent);
  color: var(--accent-fg);
  border-radius: 6px;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 600;
}
.apply:hover {
  background: #0060e0;
}
.preview {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: WorkspaceShell でタブ種別により出し分け**

`src/renderer/src/workspace/WorkspaceShell.tsx` を次の内容に置き換える:

```tsx
import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
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
        {activeKind === 'table' ? <FilterBar /> : <QueryEditor />}
        <ResultsGrid />
        <StatusBar />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 型チェック＆ビルド**

Run: `npm run typecheck && npm run build`
Expected: PASS（`out/` までビルド成功）

- [ ] **Step 5: 全テスト**

Run: `npx vitest run`
Expected: PASS（filterBuilder 含む全件緑、integration は skip）

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/workspace/FilterBar.tsx src/renderer/src/workspace/FilterBar.module.css src/renderer/src/workspace/WorkspaceShell.tsx
git commit -m "feat: FilterBar を追加しテーブルタブで出し分け"
```

- [ ] **Step 7: 目視チェック（要ローカル MySQL、対話実行のため人手で）**

`npm run dev` で:
- [ ] テーブルをクリック → ▦タブが開き、グリッドに先頭100行。
- [ ] 「＋ 条件を追加」→ カラム/演算子を選び値を入れて Apply → 絞り込まれる。
- [ ] 複数行 AND、有効化チェックの ON/OFF、IS NULL（値欄なし）、BETWEEN（2入力）、IN（カンマ）。
- [ ] 生成SQLプレビューが条件に追従。
- [ ] 「＋」(タブバー) で ⚡SQLタブが開き、従来通りエディタ＋⌘↵実行。
- [ ] 同じテーブルを再クリックで既存タブにフォーカス（重複しない）。

---

## 完了の定義（Done）

- [ ] テーブルクリックで TableTab（フィルターバー＋グリッド）が開く。SqlTab（エディタ）と共存。
- [ ] コア演算子（`= <> < > <= >= IS NULL IS NOT NULL 含む 含まない IN BETWEEN`）で AND 絞り込み。
- [ ] クエリはパラメータ化（`?`＋params）。識別子はバッククォート＋ホワイトリスト。
- [ ] `buildFilteredQuery` の単体テストが緑。`npm run typecheck` / `npx vitest run` / `npm run build` 成功。

## 本スライスで未対応（後続）

OR グループ化、Raw SQL 行、Any column、大文字小文字区別、Has prefix/suffix、`NOT IN`/`NOT BETWEEN`、行ごと Apply、ソート連動、ページング、FilterBuilder のメイン側移設。
