# フィルタUX改善 + quick filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルタブのフィルタ体験を強化する — セル右クリックの quick filter（即適用）、フィルタ条件の複製、適用状態（未適用/適用中）の正確な可視化。

**Architecture:** dirty 判定は `appliedFilters` スナップショットと純粋関数 `sameFilterEffect`（既存 `buildWhere` の WHERE＋params 比較）で行う。quick filter は `ResultsGrid` のセル右クリック統合メニューから store の `quickFilter` を呼び即 `runTable` する。IPC・メイン・preload・shared types は無変更。

**Tech Stack:** React 18 + TypeScript（CSS Modules）、zustand、vitest。

**関連**: issue #10 / spec `docs/superpowers/specs/2026-06-09-filter-ux-quick-filter-design.md`

---

## File Structure

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/renderer/src/store/filterBuilder.ts` | 変更 | `sameFilterEffect` / `countUsableFilters` を追加（export） |
| `src/renderer/src/store/filterBuilder.test.ts` | 変更 | 上記2関数のユニットテスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | `TableTab.appliedFilters`、`duplicateFilter`/`quickFilter`、applyFilters のスナップショット |
| `src/renderer/src/workspace/FilterBar.tsx` | 変更 | 複製ボタン・適用状態テキスト・Apply 強調・プレビューラベル |
| `src/renderer/src/workspace/FilterBar.module.css` | 変更 | 複製ボタン・状態テキスト・dirty Apply のスタイル |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | セル右クリック統合メニュー・quick filter 呼び出し |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | コンテキストメニューの区切り線 `.ctxSep` |

---

## Task 1: 純粋関数 `sameFilterEffect` / `countUsableFilters`（TDD）

**Files:**
- Modify: `src/renderer/src/store/filterBuilder.ts`
- Test: `src/renderer/src/store/filterBuilder.test.ts`

- [ ] **Step 1: 失敗するテストを追記**

`src/renderer/src/store/filterBuilder.test.ts` の import 行を差し替える:

```ts
import { buildFilteredQuery, buildCountQuery, sameFilterEffect, countUsableFilters } from './filterBuilder'
```

同ファイルの末尾（`describe('buildCountQuery', ...)` ブロックの後）に追記する:

```ts
describe('sameFilterEffect', () => {
  const cols = ['id', 'name']
  const f = (over: Partial<FilterCondition>): FilterCondition => ({
    id: 'x', enabled: true, column: 'id', operator: '=', value: '', value2: '', ...over
  })

  it('id だけ違う同内容は true', () => {
    expect(sameFilterEffect(cols, [f({ id: 'a', value: '5' })], [f({ id: 'b', value: '5' })])).toBe(true)
  })
  it('無効化された条件の有無は効果に影響しない（true）', () => {
    const a = [f({ value: '5' })]
    const b = [f({ value: '5' }), f({ column: 'name', operator: 'contains', value: 'z', enabled: false })]
    expect(sameFilterEffect(cols, a, b)).toBe(true)
  })
  it('空値の条件追加は効果なし（true）', () => {
    const a = [f({ value: '5' })]
    const b = [f({ value: '5' }), f({ column: 'name', operator: '=', value: '' })]
    expect(sameFilterEffect(cols, a, b)).toBe(true)
  })
  it('値の変更は false', () => {
    expect(sameFilterEffect(cols, [f({ value: '5' })], [f({ value: '6' })])).toBe(false)
  })
  it('演算子の変更は false', () => {
    expect(sameFilterEffect(cols, [f({ value: '5', operator: '=' })], [f({ value: '5', operator: '<>' })])).toBe(false)
  })
  it('列の変更は false', () => {
    expect(sameFilterEffect(cols, [f({ column: 'id', value: '5' })], [f({ column: 'name', value: '5' })])).toBe(false)
  })
  it('ホワイトリスト外の列を含む差分は無視（true）', () => {
    const a = [f({ value: '5' })]
    const b = [f({ value: '5' }), f({ column: 'evil', value: 'z' })]
    expect(sameFilterEffect(cols, a, b)).toBe(true)
  })
})

describe('countUsableFilters', () => {
  const cols = ['id', 'name']
  const f = (over: Partial<FilterCondition>): FilterCondition => ({
    id: 'x', enabled: true, column: 'id', operator: '=', value: '', value2: '', ...over
  })

  it('有効＋実効のある条件のみ数える', () => {
    const list = [
      f({ value: '5' }),
      f({ column: 'name', operator: 'contains', value: 'a' }),
      f({ value: '9', enabled: false }),
      f({ column: 'name', operator: '=', value: '' }),
      f({ column: 'evil', value: 'z' })
    ]
    expect(countUsableFilters(cols, list)).toBe(2)
  })
  it('is_null は値なしでも実効ありとして数える', () => {
    expect(countUsableFilters(cols, [f({ operator: 'is_null', value: '' })])).toBe(1)
    expect(countUsableFilters(cols, [f({ operator: 'is_not_null', value: '' })])).toBe(1)
  })
  it('0 件は 0', () => {
    expect(countUsableFilters(cols, [])).toBe(0)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm run test -- src/renderer/src/store/filterBuilder.test.ts`
Expected: FAIL（`sameFilterEffect`/`countUsableFilters` が export されていない）

- [ ] **Step 3: 実装を追記**

`src/renderer/src/store/filterBuilder.ts` の末尾（`buildCountQuery` 関数の後）に追記する。`buildWhere` と `isUsable` は同ファイル内の既存関数なのでそのまま使える:

```ts
// 2つの条件集合が同じ WHERE 効果（適用しても結果が変わらない）かを判定する。
// 内部の buildWhere を再利用し where 文字列と params の一致で比較するため、
// id の違い・無効化・空値など結果に影響しない差分は自動的に無視される。
export function sameFilterEffect(
  columns: string[],
  a: FilterCondition[],
  b: FilterCondition[]
): boolean {
  const wa = buildWhere(columns, a)
  const wb = buildWhere(columns, b)
  return wa.where === wb.where && JSON.stringify(wa.params) === JSON.stringify(wb.params)
}

// 有効かつ実効のある（isUsable な）条件の件数。適用中バッジ用。
export function countUsableFilters(columns: string[], conditions: FilterCondition[]): number {
  return conditions.filter((c) => isUsable(c, columns)).length
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm run test -- src/renderer/src/store/filterBuilder.test.ts`
Expected: PASS（既存 + 追加分すべて green）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/store/filterBuilder.ts src/renderer/src/store/filterBuilder.test.ts
git commit -m "feat: フィルタ効果比較 sameFilterEffect/countUsableFilters を追加 (#10)"
```

---

## Task 2: store — appliedFilters / duplicateFilter / quickFilter

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

> store アクションは既存方針どおりユニットテストは追加しない（型チェック＋既存テスト回帰＋手動で確認）。

- [ ] **Step 1: import に `FilterOperator` を追加**

`useAppStore.ts` 冒頭の型 import を差し替える:

```ts
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult,
  FilterCondition,
  FilterOperator,
  TableSort,
  RowEdit,
  PendingInsert
} from '../../../shared/types'
```

- [ ] **Step 2: `TableTab` に `appliedFilters` を追加**

`TableTab` インターフェースの `filters: FilterCondition[]` の直後に1行追加する:

```ts
  filters: FilterCondition[]
  appliedFilters: FilterCondition[] // いま表示中の結果を生んだフィルタのスナップショット
```

- [ ] **Step 3: `makeTableTab` で初期化**

`makeTableTab` 内の `filters: [],` の直後に追加する:

```ts
    filters: [],
    appliedFilters: [],
```

- [ ] **Step 4: `AppState` に2アクションを宣言**

`AppState` インターフェースの `applyFilters: (tabId: string) => Promise<void>` の直後に追加する:

```ts
  applyFilters: (tabId: string) => Promise<void>
  duplicateFilter: (tabId: string, filterId: string) => void
  quickFilter: (tabId: string, column: string, operator: FilterOperator, value: unknown) => Promise<void>
```

- [ ] **Step 5: `applyFilters` で appliedFilters をスナップショット**

`applyFilters` 内の `patchTableTab(...)` 呼び出しを次に差し替える（`appliedFilters: t.filters` を追加）:

```ts
      patchTableTab(tabId, (t) => ({ ...t, appliedFilters: t.filters, page: 0, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null }))
```

- [ ] **Step 6: `duplicateFilter` と `quickFilter` を実装**

`applyFilters` の実装ブロックの直後（`setSort` の前）に追加する:

```ts
    duplicateFilter(tabId, filterId) {
      patchTableTab(tabId, (t) => {
        const idx = t.filters.findIndex((f) => f.id === filterId)
        if (idx === -1) return t
        const clone = { ...t.filters[idx], id: genId() }
        return {
          ...t,
          filters: [...t.filters.slice(0, idx + 1), clone, ...t.filters.slice(idx + 1)]
        }
      })
    },

    async quickFilter(tabId, column, operator, value) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      const valueless = operator === 'is_null' || operator === 'is_not_null'
      const cond: FilterCondition = {
        id: genId(),
        enabled: true,
        column,
        operator,
        value: valueless ? '' : value == null ? '' : String(value),
        value2: ''
      }
      patchTableTab(tabId, (t) => {
        const filters = [...t.filters, cond]
        return {
          ...t,
          filters,
          appliedFilters: filters,
          page: 0,
          edits: {},
          inserts: [],
          deletes: {},
          editError: null,
          selectedRowIndex: null
        }
      })
      await runTable(tabId, { recount: true })
    },
```

- [ ] **Step 7: 型チェックと回帰テスト**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run test`
Expected: PASS（既存テストが全件通る。新規 store テストはなし）

- [ ] **Step 8: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: store に appliedFilters/duplicateFilter/quickFilter を追加 (#10)"
```

---

## Task 3: FilterBar — 複製ボタン・適用状態表示

**Files:**
- Modify (full replace): `src/renderer/src/workspace/FilterBar.tsx`
- Modify: `src/renderer/src/workspace/FilterBar.module.css`

> キーボード/表示挙動は手動確認（既存方針）。Task 1・2 の成果物に依存。

- [ ] **Step 1: `FilterBar.tsx` を全面置き換え**

```tsx
import { useMemo, type KeyboardEvent } from 'react'
import type { FilterOperator } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { buildFilteredQuery, sameFilterEffect, countUsableFilters } from '../store/filterBuilder'
import { OPERATORS, OPERATOR_VALUE_KIND } from '../lib/filterOperators'
import ExportMenu from './ExportMenu'
import styles from './FilterBar.module.css'

export default function FilterBar(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const addFilter = useAppStore((s) => s.addFilter)
  const removeFilter = useAppStore((s) => s.removeFilter)
  const updateFilter = useAppStore((s) => s.updateFilter)
  const duplicateFilter = useAppStore((s) => s.duplicateFilter)
  const clearFilters = useAppStore((s) => s.clearFilters)
  const applyFilters = useAppStore((s) => s.applyFilters)
  const addInsertRow = useAppStore((s) => s.addInsertRow)

  // プレビューSQLは tab（filters/columns）が変わったときだけ再計算する。
  const preview = useMemo(
    () => (tab ? buildFilteredQuery(tab.tableName, tab.columns, tab.filters).sql : ''),
    [tab]
  )

  if (!tab) return null

  // 初回ロード中（columns 未取得）は条件追加を抑止する（column='' の死にフィルタ防止）。
  const columnsReady = tab.columns.length > 0
  // 適用状態: 編集中の filters が適用済みスナップショットと同じ効果かで判定する。
  const isDirty = !sameFilterEffect(tab.columns, tab.filters, tab.appliedFilters)
  const activeCount = countUsableFilters(tab.columns, tab.appliedFilters)
  const statusText = isDirty
    ? '未適用の変更（Apply で反映）'
    : activeCount > 0
      ? `フィルタ ${activeCount} 件 適用中`
      : ''
  const applyOnEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !tab.running) void applyFilters(tab.id)
  }

  return (
    <div className={styles.bar}>
      {tab.filters.length === 0 ? (
        <div className={styles.empty}>フィルターなし（全件先頭100行）</div>
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
                <span className={styles.valPlaceholder} />
              ) : valueKind === 'two' ? (
                <span className={styles.twoVals}>
                  <input
                    className={styles.val}
                    value={f.value}
                    placeholder="下限"
                    onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                    onKeyDown={applyOnEnter}
                  />
                  <span className={styles.tilde}>〜</span>
                  <input
                    className={styles.val}
                    value={f.value2}
                    placeholder="上限"
                    onChange={(e) => updateFilter(tab.id, f.id, { value2: e.target.value })}
                    onKeyDown={applyOnEnter}
                  />
                </span>
              ) : (
                <input
                  className={styles.val}
                  value={f.value}
                  placeholder={valueKind === 'list' ? 'カンマ区切り' : '値'}
                  onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                  onKeyDown={applyOnEnter}
                />
              )}
              <button className={styles.iconBtn} onClick={() => removeFilter(tab.id, f.id)} title="削除">
                −
              </button>
              <button
                className={styles.iconBtn}
                onClick={() => duplicateFilter(tab.id, f.id)}
                title="複製"
              >
                ⧉
              </button>
              <button
                className={styles.iconBtn}
                disabled={!columnsReady}
                onClick={() => addFilter(tab.id)}
                title="条件を追加"
              >
                ＋
              </button>
            </div>
          )
        })
      )}
      <div className={styles.footer}>
        {tab.primaryKey.length > 0 && (
          <button
            className={styles.insertBtn}
            disabled={tab.running}
            onClick={() => addInsertRow(tab.id)}
          >
            ＋ 行を追加
          </button>
        )}
        <button className={styles.addBtn} disabled={!columnsReady} onClick={() => addFilter(tab.id)}>
          ＋ 条件を追加
        </button>
        {statusText && (
          <span className={isDirty ? `${styles.status} ${styles.statusDirty}` : styles.status}>
            {statusText}
          </span>
        )}
        <div className={styles.spacer} />
        <ExportMenu disabled={!tab.result || tab.running} />
        <button
          className={styles.clear}
          onClick={() => {
            clearFilters(tab.id)
            void applyFilters(tab.id)
          }}
        >
          Clear
        </button>
        <button
          className={isDirty ? `${styles.apply} ${styles.applyDirty}` : styles.apply}
          disabled={tab.running}
          onClick={() => void applyFilters(tab.id)}
        >
          Apply
        </button>
      </div>
      <div className={styles.preview} title={preview}>
        {(isDirty ? '未適用: ' : '適用中: ') + preview}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `FilterBar.module.css` の `.apply` を差し替え、`.applyDirty`/`.status`/`.statusDirty` を追加**

`.apply` / `.apply:hover` / `.apply:disabled` の3ブロックを次に置き換える（dirty 時のみ塗りつぶし強調にするため、未適用でない通常時はアウトライン表示にする）:

```css
.apply {
  border: 1px solid var(--accent);
  background: var(--bg);
  color: var(--accent);
  border-radius: 6px;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 600;
}
.apply:hover {
  background: #eef4ff;
}
.apply:disabled {
  opacity: 0.5;
  cursor: default;
}
.applyDirty {
  background: var(--accent);
  color: var(--accent-fg);
}
.applyDirty:hover {
  background: #0060e0;
}
.status {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
.statusDirty {
  color: var(--accent);
  font-weight: 600;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: 回帰テスト**

Run: `npm run test`
Expected: PASS

- [ ] **Step 5: 手動確認（dev 起動）**

Run: `npm run dev`
確認項目（テーブルを開いた状態で）:
- 各フィルタ行に「複製（⧉）」が出て、押すと同内容の行が直後に増える。
- フィルタを編集（値入力など）すると Apply が塗りつぶしで強調され、「未適用の変更」が表示される。
- Apply 後は強調が消え、「フィルタ N 件 適用中」が出る。値を元に戻すと未適用表示も消える。
- SQL プレビューの先頭に「適用中:/未適用:」が付く。

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/workspace/FilterBar.tsx src/renderer/src/workspace/FilterBar.module.css
git commit -m "feat: フィルタ条件の複製ボタンと適用状態表示を追加 (#10)"
```

---

## Task 4: ResultsGrid — セル右クリック quick filter 統合メニュー

**Files:**
- Modify (full replace): `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

> Task 2 の `quickFilter` に依存。キーボード/メニュー挙動は手動確認。

- [ ] **Step 1: `ResultsGrid.tsx` を全面置き換え**

```tsx
import { useMemo, useRef, useState, useEffect } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import type {
  QueryResult,
  TableSort,
  RowEdit,
  PendingInsert,
  FilterOperator
} from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { rowKeyOf, pkValuesOf } from '../store/rowKey'
import styles from './ResultsGrid.module.css'

type Row = Record<string, unknown>

type CtxMenu =
  | {
      kind: 'cell'
      x: number
      y: number
      column: string
      value: unknown
      rowKey: string
      pkValues: Record<string, unknown>
      isDeleted: boolean
    }
  | { kind: 'insert'; x: number; y: number; localId: string }

export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setSort = useAppStore((s) => s.setSort)
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const selectRow = useAppStore((s) => s.selectRow)
  const updateInsertCell = useAppStore((s) => s.updateInsertCell)
  const removeInsertRow = useAppStore((s) => s.removeInsertRow)
  const stageDelete = useAppStore((s) => s.stageDelete)
  const quickFilter = useAppStore((s) => s.quickFilter)

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
  const inserts = isTable ? tab.inserts : []
  const deletes = isTable ? tab.deletes : {}
  const selectedRowIndex = isTable ? tab.selectedRowIndex : null
  const onSelectRow = isTable ? (index: number): void => selectRow(tab.id, index) : undefined
  // quick filter はテーブルタブのみ（SQL タブはクエリを所有しないため）。主キー不要。
  const onQuickFilter = isTable
    ? (column: string, operator: FilterOperator, value: unknown): void =>
        void quickFilter(tab.id, column, operator, value)
    : undefined

  return (
    <Grid
      result={tab.result}
      sort={sort}
      onSort={onSort}
      editable={editable}
      primaryKey={primaryKey}
      edits={edits}
      inserts={inserts}
      deletes={deletes}
      selectedRowIndex={selectedRowIndex}
      onSelectRow={onSelectRow}
      onEdit={editable ? (row, col, val) => setCellEdit(tab.id, row, col, val) : undefined}
      onNull={editable ? (row, col) => setCellNull(tab.id, row, col) : undefined}
      onUpdateInsert={
        editable ? (localId, col, val) => updateInsertCell(tab.id, localId, col, val) : undefined
      }
      onRemoveInsert={editable ? (localId) => removeInsertRow(tab.id, localId) : undefined}
      onStageDelete={
        editable ? (rowKey, pkValues) => stageDelete(tab.id, rowKey, pkValues) : undefined
      }
      onQuickFilter={onQuickFilter}
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
  inserts,
  deletes,
  selectedRowIndex,
  onSelectRow,
  onEdit,
  onNull,
  onUpdateInsert,
  onRemoveInsert,
  onStageDelete,
  onQuickFilter
}: {
  result: QueryResult
  sort: TableSort | null
  onSort?: (column: string) => void
  editable: boolean
  primaryKey: string[]
  edits: Record<string, RowEdit>
  inserts: PendingInsert[]
  deletes: Record<string, Record<string, unknown>>
  selectedRowIndex: number | null
  onSelectRow?: (index: number) => void
  onEdit?: (row: Row, column: string, value: string) => void
  onNull?: (row: Row, column: string) => void
  onUpdateInsert?: (localId: string, column: string, value: string) => void
  onRemoveInsert?: (localId: string) => void
  onStageDelete?: (rowKey: string, pkValues: Record<string, unknown>) => void
  onQuickFilter?: (column: string, operator: FilterOperator, value: unknown) => void
}): JSX.Element {
  const [editing, setEditing] = useState<{ rowKey: string; column: string } | null>(null)
  const [draft, setDraft] = useState('')
  // Enter/Esc 確定後に trailing blur が再度 confirm するのを防ぐ（編集開始ごとにリセット）
  const committedRef = useRef(false)

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  // コンテキストメニューをページ外クリックで閉じる
  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

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
            const isDeleted = editable && rowKey in deletes
            const rowEdit = editable ? edits[rowKey] : undefined

            return (
              <tr
                key={r.id}
                className={
                  isDeleted
                    ? styles.deleteRow
                    : r.index === selectedRowIndex
                      ? styles.selected
                      : undefined
                }
                onClick={onSelectRow ? () => onSelectRow(r.index) : undefined}
              >
                {r.getVisibleCells().map((cell) => {
                  const colId = cell.column.id
                  const isDirty = rowEdit ? colId in rowEdit.values : false
                  const value = isDirty ? rowEdit!.values[colId] : (cell.getValue() as unknown)
                  const isEditingThis = editing?.rowKey === rowKey && editing?.column === colId

                  const startEdit = (): void => {
                    if (!editable) return
                    committedRef.current = false
                    setEditing({ rowKey, column: colId })
                    setDraft(value === null || value === undefined ? '' : String(value))
                  }
                  const confirm = (): void => {
                    if (committedRef.current) return
                    committedRef.current = true
                    onEdit?.(original, colId, draft)
                    setEditing(null)
                  }
                  const cancel = (): void => {
                    committedRef.current = true
                    setEditing(null)
                  }
                  const setNull = (): void => {
                    committedRef.current = true
                    onNull?.(original, colId)
                    setEditing(null)
                  }

                  const cls =
                    [isDirty ? styles.dirty : '', isEditingThis ? styles.editing : '']
                      .filter(Boolean)
                      .join(' ') || undefined

                  return (
                    <td
                      key={cell.id}
                      className={cls}
                      onDoubleClick={editable && !isDeleted ? startEdit : undefined}
                      onContextMenu={
                        onQuickFilter
                          ? (e) => {
                              e.preventDefault()
                              onSelectRow?.(r.index)
                              setCtxMenu({
                                kind: 'cell',
                                x: e.clientX,
                                y: e.clientY,
                                column: colId,
                                value: original[colId],
                                rowKey,
                                pkValues: editable ? pkValuesOf(primaryKey, original) : {},
                                isDeleted
                              })
                            }
                          : undefined
                      }
                    >
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
        <tbody>
          {inserts.map((insert, insertIndex) => (
            <tr
              key={insert.localId}
              className={styles.insertRow}
              onClick={
                onSelectRow ? () => onSelectRow(result.rows.length + insertIndex) : undefined
              }
              onContextMenu={(e) => {
                e.preventDefault()
                onSelectRow?.(result.rows.length + insertIndex)
                setCtxMenu({ kind: 'insert', x: e.clientX, y: e.clientY, localId: insert.localId })
              }}
            >
              {result.columns.map((col) => {
                const value = insert.values[col.name]
                const colId = col.name
                const isEditingThis =
                  editing?.rowKey === `insert-${insert.localId}` && editing?.column === colId

                const startEdit = (): void => {
                  if (!editable) return
                  committedRef.current = false
                  setEditing({ rowKey: `insert-${insert.localId}`, column: colId })
                  setDraft(value === null || value === undefined ? '' : String(value))
                }
                const confirm = (): void => {
                  if (committedRef.current) return
                  committedRef.current = true
                  onUpdateInsert?.(insert.localId, colId, draft)
                  setEditing(null)
                }
                const cancel = (): void => {
                  committedRef.current = true
                  setEditing(null)
                }

                const cls = isEditingThis ? styles.editing : undefined
                return (
                  <td
                    key={colId}
                    className={cls}
                    onDoubleClick={editable ? startEdit : undefined}
                  >
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
                      </span>
                    ) : value === null ? (
                      <span className={styles.null}>NULL</span>
                    ) : value === undefined || value === '' ? (
                      <span className={styles.insertAutoCell}>—</span>
                    ) : (
                      String(value)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {ctxMenu && (
        <div
          className={styles.ctxMenu}
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.kind === 'cell' && (
            <>
              {ctxMenu.value === null || ctxMenu.value === undefined ? (
                <>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, 'is_null', null)
                      setCtxMenu(null)
                    }}
                  >
                    IS NULL
                  </div>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, 'is_not_null', null)
                      setCtxMenu(null)
                    }}
                  >
                    IS NOT NULL
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, '=', ctxMenu.value)
                      setCtxMenu(null)
                    }}
                  >
                    = この値で絞り込む
                  </div>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, '<>', ctxMenu.value)
                      setCtxMenu(null)
                    }}
                  >
                    ≠ この値
                  </div>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, 'contains', ctxMenu.value)
                      setCtxMenu(null)
                    }}
                  >
                    含む
                  </div>
                </>
              )}
              {onStageDelete && (
                <>
                  <div className={styles.ctxSep} />
                  {ctxMenu.isDeleted ? (
                    <div
                      className={styles.ctxItem}
                      onClick={() => {
                        onStageDelete(ctxMenu.rowKey, ctxMenu.pkValues)
                        setCtxMenu(null)
                      }}
                    >
                      削除を取り消す
                    </div>
                  ) : (
                    <div
                      className={`${styles.ctxItem} ${styles.ctxDanger}`}
                      onClick={() => {
                        onStageDelete(ctxMenu.rowKey, ctxMenu.pkValues)
                        setCtxMenu(null)
                      }}
                    >
                      行を削除
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {ctxMenu.kind === 'insert' && (
            <div
              className={`${styles.ctxItem} ${styles.ctxDanger}`}
              onClick={() => {
                onRemoveInsert?.(ctxMenu.localId)
                setCtxMenu(null)
              }}
            >
              この新規行を破棄
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: `ResultsGrid.module.css` に `.ctxSep` を追加**

ファイル末尾に追記する:

```css
.ctxSep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS（`type MouseEvent` import を削除した点に注意。未使用 import が残っていないこと）

- [ ] **Step 4: 回帰テスト**

Run: `npm run test`
Expected: PASS

- [ ] **Step 5: 手動確認（dev 起動）**

Run: `npm run dev`
確認項目:
- 非NULLセルを右クリック → 「= この値で絞り込む / ≠ この値 / 含む」が出て、選ぶと即フィルタが追加・適用される。
- NULLセルを右クリック → 「IS NULL / IS NOT NULL」が出る。
- 主キーありテーブルでは区切り線の下に「行を削除」（削除予定行なら「削除を取り消す」）が併置される。
- 主キーなしテーブルでも quick filter は出る（行操作は出ない）。
- 新規（INSERT）行のセルは「この新規行を破棄」のみ。
- SQL タブのセル右クリックは従来どおりブラウザ既定（カスタムメニューなし）。
- 未コミットのセル編集がある状態で quick filter を選ぶと破棄確認が出る。

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: セル右クリックの quick filter 統合メニューを追加 (#10)"
```

---

## Task 5: 最終検証（型・テスト・ビルド）

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: 全テスト**

Run: `npm run test`
Expected: PASS（全件 green）

- [ ] **Step 3: 本番ビルド**

Run: `npm run build`
Expected: main / preload / renderer 各層がエラーなくバンドルされる。

- [ ] **Step 4: 完了**

すべて green なら実装完了。`superpowers:finishing-a-development-branch` で PR 作成へ進む。

---

## Self-Review メモ

- **Spec coverage**:
  - quick filter（セル統合メニュー・操作セット・NULL出し分け・即適用・非編集テーブル対応）＝Task 4 + Task 2 `quickFilter`。
  - 複製＝Task 2 `duplicateFilter` + Task 3 複製ボタン。
  - 適用状態の正確な可視化＝Task 1 `sameFilterEffect`/`countUsableFilters` + Task 2 `appliedFilters` + Task 3（Apply強調・状態テキスト・プレビューラベル）。
  - SQL タブ非対象＝Task 4 で `onQuickFilter` を table タブのみに限定。
- **Placeholder scan**: TODO/TBD なし。各コード片は最終形。
- **Type consistency**: `quickFilter(tabId, column, operator: FilterOperator, value: unknown)`、`duplicateFilter(tabId, filterId)`、`sameFilterEffect(columns, a, b)`、`countUsableFilters(columns, conditions)`、`appliedFilters: FilterCondition[]`、`onQuickFilter?: (column, operator, value) => void`、`CtxMenu` の `kind: 'cell' | 'insert'` は Task 1〜4 で一貫。`MouseEvent` import 削除済み（未使用回避）。
