# 行追加（INSERT）/ 行削除（DELETE）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルビューで行の追加（INSERT）と削除（DELETE）をステージング＋⌘S 一括コミットで行えるようにする。

**Architecture:** 既存の UPDATE ステージング基盤（`applyChanges` / `EditBar` / `⌘S`）を再利用し、`TableTab` に `inserts: PendingInsert[]` と `deletes: Record<string, ...>` を追加する（Approach A: 分離フィールド）。SQL 生成は純粋関数 `buildInsertStatements` / `buildDeleteStatements` として `editBuilder.ts` に追加する。コミット順は DELETE → UPDATE → INSERT で1トランザクション。

**Tech Stack:** React 18, Zustand, Vitest (unit / gated integration), mysql2, TypeScript strict, Electron IPC（変更なし）, @tanstack/react-table

---

## ファイル構成

| ファイル | 区分 | 変更内容 |
|---|---|---|
| `src/shared/types.ts` | 変更 | `PendingInsert` 型を追加 |
| `src/renderer/src/store/editBuilder.ts` | 変更 | `buildInsertStatements` / `buildDeleteStatements` を追加 |
| `src/renderer/src/store/editBuilder.test.ts` | 変更 | INSERT / DELETE 文生成ユニットテストを追加 |
| `src/renderer/src/store/useAppStore.ts` | 変更 | `TableTab` 拡張・新アクション・`commitEdits` / `discardEdits` / ナビ保護を更新 |
| `src/renderer/src/workspace/FilterBar.tsx` | 変更 | 「＋ 行を追加」ボタンを追加 |
| `src/renderer/src/workspace/FilterBar.module.css` | 変更 | 追加ボタンのスタイル |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | INSERT 行表示・DELETE ハイライト・右クリックコンテキストメニュー |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | INSERT / DELETE / コンテキストメニューのスタイル |
| `src/renderer/src/workspace/EditBar.tsx` | 変更 | INSERT / DELETE カウントを含む表示 |
| `src/renderer/src/workspace/DetailPane.tsx` | 変更 | INSERT 行選択時の「グリッドで編集」メッセージ |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | INSERT / DELETE / 混合トランザクションの結合テスト |

---

## Task 1: PendingInsert 型と SQL 生成関数（TDD）

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/store/editBuilder.ts`
- Modify: `src/renderer/src/store/editBuilder.test.ts`

- [ ] **Step 1: `src/shared/types.ts` に `PendingInsert` を追加**

`SqlStatement` の定義の直後（ファイル末尾付近）に追加する:

```ts
// INSERT ステージング中の1行
export interface PendingInsert {
  localId: string                       // ローカル一意 ID（"ins-0", "ins-1" …）
  values: Record<string, string | null> // 列名 → 入力値（空文字は SQL から除外）
}
```

- [ ] **Step 2: `buildInsertStatements` のテストを書く**

`src/renderer/src/store/editBuilder.test.ts` に追記（既存の `describe` の外に新しい `describe` を追加）:

```ts
import { buildUpdateStatements, buildInsertStatements, buildDeleteStatements } from './editBuilder'
import type { RowEdit, PendingInsert } from '../../../shared/types'

// … 既存の describe('buildUpdateStatements', ...) はそのまま …

describe('buildInsertStatements', () => {
  it('単一列 INSERT', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: '山田' } }]
    expect(buildInsertStatements('users', inserts)).toEqual([
      { sql: 'INSERT INTO `users` (`name`) VALUES (?)', params: ['山田'] }
    ])
  })

  it('複数列 INSERT', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: '太郎', email: 'a@b.com' } }]
    const r = buildInsertStatements('users', inserts)
    expect(r[0].sql).toBe('INSERT INTO `users` (`name`, `email`) VALUES (?, ?)')
    expect(r[0].params).toEqual(['太郎', 'a@b.com'])
  })

  it('空文字の列は SQL から除外', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: '太郎', email: '' } }]
    const r = buildInsertStatements('users', inserts)
    expect(r[0].sql).toBe('INSERT INTO `users` (`name`) VALUES (?)')
    expect(r[0].params).toEqual(['太郎'])
  })

  it('null 値は param が null', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { name: null } }]
    const r = buildInsertStatements('users', inserts)
    expect(r[0].params).toEqual([null])
  })

  it('識別子のバッククォートを2重化', () => {
    const inserts: PendingInsert[] = [{ localId: 'ins-0', values: { 'c`ol': 'v' } }]
    const r = buildInsertStatements('we`ird', inserts)
    expect(r[0].sql).toBe('INSERT INTO `we``ird` (`c``ol`) VALUES (?)')
  })

  it('values がすべて空文字の行はスキップ', () => {
    const inserts: PendingInsert[] = [
      { localId: 'ins-0', values: { name: '', email: '' } },
      { localId: 'ins-1', values: { name: '花子' } }
    ]
    const r = buildInsertStatements('users', inserts)
    expect(r).toHaveLength(1)
    expect(r[0].params).toEqual(['花子'])
  })

  it('inserts が空なら空配列', () => {
    expect(buildInsertStatements('users', [])).toEqual([])
  })
})

describe('buildDeleteStatements', () => {
  it('単一 PK の DELETE', () => {
    const deletes = { 'k1': { id: 6 } }
    expect(buildDeleteStatements('users', ['id'], deletes)).toEqual([
      { sql: 'DELETE FROM `users` WHERE `id` = ?', params: [6] }
    ])
  })

  it('複合 PK は WHERE を AND 結合', () => {
    const deletes = { 'k1': { a: 1, b: 2 } }
    const r = buildDeleteStatements('t', ['a', 'b'], deletes)
    expect(r[0].sql).toBe('DELETE FROM `t` WHERE `a` = ? AND `b` = ?')
    expect(r[0].params).toEqual([1, 2])
  })

  it('識別子のバッククォートを2重化', () => {
    const deletes = { 'k1': { 'i`d': 3 } }
    const r = buildDeleteStatements('we`ird', ['i`d'], deletes)
    expect(r[0].sql).toBe('DELETE FROM `we``ird` WHERE `i``d` = ?')
  })

  it('primaryKey 空なら空配列', () => {
    expect(buildDeleteStatements('t', [], { k: { id: 1 } })).toEqual([])
  })

  it('deletes が空なら空配列', () => {
    expect(buildDeleteStatements('t', ['id'], {})).toEqual([])
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

```bash
npx vitest run src/renderer/src/store/editBuilder.test.ts
```

Expected: `buildInsertStatements is not a function` などで FAIL

- [ ] **Step 4: `editBuilder.ts` に関数を実装**

`src/renderer/src/store/editBuilder.ts` の末尾に追加:

```ts
import type { RowEdit, PendingInsert, SqlStatement } from '../../../shared/types'

// … 既存の buildUpdateStatements / quoteIdent はそのまま …

/**
 * PendingInsert の各行を1つの INSERT 文にする。
 * 空文字の列は SQL から除外して DB のデフォルト値（AUTO_INCREMENT 等）に委ねる。
 * null は明示的に NULL として渡す。
 * values がすべて空文字 or 空の PendingInsert はスキップ。
 */
export function buildInsertStatements(
  table: string,
  inserts: PendingInsert[]
): SqlStatement[] {
  const statements: SqlStatement[] = []
  for (const insert of inserts) {
    const cols = Object.keys(insert.values).filter((c) => insert.values[c] !== '')
    if (cols.length === 0) continue
    const colList = cols.map(quoteIdent).join(', ')
    const placeholders = cols.map(() => '?').join(', ')
    const params = cols.map((c) => insert.values[c])
    statements.push({
      sql: `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})`,
      params
    })
  }
  return statements
}

/**
 * deletes（行キー → pk値）の各エントリを1つの DELETE 文にする。
 * primaryKey が空なら空配列。
 */
export function buildDeleteStatements(
  table: string,
  primaryKey: string[],
  deletes: Record<string, Record<string, unknown>>
): SqlStatement[] {
  if (primaryKey.length === 0) return []
  return Object.values(deletes).map((pkValues) => {
    const whereClause = primaryKey.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const params = primaryKey.map((c) => pkValues[c])
    return {
      sql: `DELETE FROM ${quoteIdent(table)} WHERE ${whereClause}`,
      params
    }
  })
}
```

- [ ] **Step 5: テストが通ることを確認**

```bash
npx vitest run src/renderer/src/store/editBuilder.test.ts
```

Expected: すべて PASS（既存テスト含む）

- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts src/renderer/src/store/editBuilder.ts src/renderer/src/store/editBuilder.test.ts
git commit -m "feat: PendingInsert 型と INSERT/DELETE 文生成を追加 (TDD)"
```

---

## Task 2: useAppStore の拡張

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

- [ ] **Step 1: import に `buildInsertStatements` / `buildDeleteStatements` / `PendingInsert` を追加**

ファイル冒頭の import を以下に変更:

```ts
import { buildUpdateStatements, buildInsertStatements, buildDeleteStatements } from './editBuilder'
import type { FilterCondition, TableSort, RowEdit, PendingInsert, AppError } from '../../../shared/types'
```

- [ ] **Step 2: `TableTab` 型に `inserts` / `deletes` を追加**

現在の `TableTab` 定義（`src/renderer/src/store/useAppStore.ts` 29行目付近）に追加:

```ts
export interface TableTab extends BaseTab {
  kind: 'table'
  tableName: string
  columns: string[]
  filters: FilterCondition[]
  sort: TableSort | null
  pageSize: number
  page: number
  total: number | null
  primaryKey: string[]
  edits: Record<string, RowEdit>
  inserts: PendingInsert[]                          // ← 追加
  deletes: Record<string, Record<string, unknown>>  // ← 追加
  editError: AppError | null
  selectedRowIndex: number | null
}
```

- [ ] **Step 3: `makeTableTab` の初期値に `inserts` / `deletes` を追加**

`makeTableTab` 関数（63行目付近）の return に追加:

```ts
function makeTableTab(name: string): TableTab {
  return {
    // … 既存フィールド …
    primaryKey: [],
    edits: {},
    inserts: [],      // ← 追加
    deletes: {},      // ← 追加
    editError: null,
    selectedRowIndex: null,
  }
}
```

- [ ] **Step 4: `AppState` のアクション型に新アクションを追加**

`AppState` インターフェース（98行目付近）の actions セクションに追加:

```ts
addInsertRow: (tabId: string) => void
updateInsertCell: (tabId: string, localId: string, column: string, value: string) => void
removeInsertRow: (tabId: string, localId: string) => void
stageDelete: (tabId: string, rowKey: string, pkValues: Record<string, unknown>) => void
```

- [ ] **Step 5: `confirmDiscard` を拡張**

`confirmDiscard` 関数（134行目付近）を以下に変更:

```ts
function confirmDiscard(tab: TableTab): boolean {
  if (
    Object.keys(tab.edits).length === 0 &&
    tab.inserts.length === 0 &&
    Object.keys(tab.deletes).length === 0
  ) return true
  return window.confirm('未コミットの変更があります。破棄して移動しますか？')
}
```

- [ ] **Step 6: `discardEdits` を拡張**

```ts
discardEdits(tabId) {
  patchTableTab(tabId, (t) => ({ ...t, edits: {}, inserts: [], deletes: {}, editError: null }))
},
```

- [ ] **Step 7: ナビゲーションアクションで `inserts` / `deletes` もリセット**

`applyFilters`・`setSort`・`setPage`・`setPageSize` の各 `patchTableTab` 呼び出しで `inserts: [], deletes: {}` を追加する（4箇所）。例えば `applyFilters`:

```ts
async applyFilters(tabId) {
  const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
  if (!tab || !confirmDiscard(tab)) return
  patchTableTab(tabId, (t) => ({
    ...t, page: 0, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null
  }))
  await runTable(tabId, { recount: true })
},
```

`setSort` / `setPage` / `setPageSize` も同様に `inserts: [], deletes: {}` を追加する。

- [ ] **Step 8: 新アクション `addInsertRow` / `updateInsertCell` / `removeInsertRow` / `stageDelete` を実装**

`discardEdits` の直後に追加（クロージャカウンター `let insertCounter = 0` は `create` コールバック冒頭に宣言）:

```ts
// create<AppState>((set, get) => {
let insertCounter = 0

// … 既存の関数 …

addInsertRow(tabId) {
  const localId = `ins-${insertCounter++}`
  patchTableTab(tabId, (t) => ({
    ...t,
    inserts: [...t.inserts, { localId, values: {} }],
    editError: null,
  }))
},

updateInsertCell(tabId, localId, column, value) {
  patchTableTab(tabId, (t) => ({
    ...t,
    inserts: t.inserts.map((ins) =>
      ins.localId === localId
        ? { ...ins, values: { ...ins.values, [column]: value } }
        : ins
    ),
    editError: null,
  }))
},

removeInsertRow(tabId, localId) {
  patchTableTab(tabId, (t) => ({
    ...t,
    inserts: t.inserts.filter((ins) => ins.localId !== localId),
    editError: null,
  }))
},

stageDelete(tabId, rowKey, pkValues) {
  patchTableTab(tabId, (t) => {
    const deletes = { ...t.deletes }
    if (rowKey in deletes) {
      delete deletes[rowKey] // トグル：すでに削除ステージング済みなら取り消す
    } else {
      deletes[rowKey] = pkValues
    }
    return { ...t, deletes, editError: null }
  })
},
```

- [ ] **Step 9: `commitEdits` を拡張**

```ts
async commitEdits(tabId) {
  const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
  const hasChanges =
    tab &&
    (Object.keys(tab.edits).length > 0 ||
      tab.inserts.length > 0 ||
      Object.keys(tab.deletes).length > 0)
  if (!tab || tab.running || !hasChanges) return

  // 順序: DELETE → UPDATE → INSERT（FK 制約違反を最小化）
  const statements = [
    ...buildDeleteStatements(tab.tableName, tab.primaryKey, tab.deletes),
    ...buildUpdateStatements(tab.tableName, tab.primaryKey, Object.values(tab.edits)),
    ...buildInsertStatements(tab.tableName, tab.inserts),
  ]
  if (statements.length === 0) return
  setTabRunning(tabId)
  try {
    const res = await window.api.applyChanges(statements)
    if (!res.ok) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table'
            ? { ...t, running: false, editError: res.error }
            : t
        )
      })
      return
    }
    patchTableTab(tabId, (t) => ({
      ...t, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null
    }))
    await runTable(tabId, { recount: true }) // INSERT/DELETE は行数が変わる
  } catch (err) {
    failTab(tabId, err)
  }
},
```

- [ ] **Step 10:型チェックが通ることを確認**

```bash
npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 11: 全ユニットテストが通ることを確認**

```bash
npx vitest run
```

Expected: すべて PASS

- [ ] **Step 12: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: TableTab に inserts/deletes を追加し INSERT/DELETE ステージングアクションを実装"
```

---

## Task 3: FilterBar に「＋ 行を追加」ボタンを追加

**Files:**
- Modify: `src/renderer/src/workspace/FilterBar.tsx`
- Modify: `src/renderer/src/workspace/FilterBar.module.css`

- [ ] **Step 1: `FilterBar.tsx` を修正**

`useAppStore` の import に `addInsertRow` を追加し、footer 部分に「＋ 行を追加」ボタンを追加する。

ファイル冒頭の import に追加:

```ts
const addInsertRow = useAppStore((s) => s.addInsertRow)
```

`footer` の `<div className={styles.footer}>` 内の先頭に追加（`＋ 条件を追加` ボタンの前）:

```tsx
{tab.primaryKey.length > 0 && (
  <button
    className={styles.insertBtn}
    disabled={tab.running}
    onClick={() => addInsertRow(tab.id)}
  >
    ＋ 行を追加
  </button>
)}
```

- [ ] **Step 2: `FilterBar.module.css` にスタイルを追加**

ファイル末尾に追加:

```css
.insertBtn {
  border: 1px solid #34c759;
  background: #f0fff4;
  color: #1a7038;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
}
.insertBtn:hover {
  background: #d6f5e0;
}
.insertBtn:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 3: 型チェックが通ることを確認**

```bash
npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/FilterBar.tsx src/renderer/src/workspace/FilterBar.module.css
git commit -m "feat: FilterBar に「＋ 行を追加」ボタンを追加"
```

---

## Task 4: ResultsGrid の INSERT 行・DELETE ハイライト・コンテキストメニュー

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

- [ ] **Step 1: `ResultsGrid.module.css` にスタイルを追加**

ファイル末尾に追加:

```css
.insertRow td {
  background: #f0fff4 !important;
  color: #1d1d1f;
}
.insertAutoCell {
  color: #a0a0a6;
  font-style: italic;
}
.deleteRow td {
  background: #fff0f0 !important;
  text-decoration: line-through;
  color: #c0392b;
}
.ctxMenu {
  position: fixed;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 4px 0;
  z-index: 1000;
  min-width: 160px;
  font-size: 12px;
}
.ctxItem {
  padding: 6px 14px;
  cursor: pointer;
}
.ctxItem:hover {
  background: #2f7bf6;
  color: #fff;
}
.ctxDanger {
  color: #ff3b30;
}
.ctxDanger:hover {
  background: #ff3b30 !important;
  color: #fff !important;
}
```

- [ ] **Step 2: `ResultsGrid.tsx` の `ResultsGrid`（ストア接続コンポーネント）を更新**

`ResultsGrid` 関数でストアから `inserts` / `deletes` / `addInsertRow` / `updateInsertCell` / `removeInsertRow` / `stageDelete` を取得し、`Grid` に渡す。

ストア接続部分（`export default function ResultsGrid()`）:

```tsx
export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setSort = useAppStore((s) => s.setSort)
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const selectRow = useAppStore((s) => s.selectRow)
  const updateInsertCell = useAppStore((s) => s.updateInsertCell)
  const removeInsertRow = useAppStore((s) => s.removeInsertRow)
  const stageDelete = useAppStore((s) => s.stageDelete)

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
  const editable = isTable && tab.primaryKey.length > 0
  const primaryKey = isTable ? tab.primaryKey : []
  const edits = isTable ? tab.edits : {}
  const inserts = isTable ? tab.inserts : []
  const deletes = isTable ? tab.deletes : {}
  const selectedRowIndex = isTable ? tab.selectedRowIndex : null
  const onSelectRow = isTable ? (index: number): void => selectRow(tab.id, index) : undefined

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
      onUpdateInsert={editable ? (localId, col, val) => updateInsertCell(tab.id, localId, col, val) : undefined}
      onRemoveInsert={editable ? (localId) => removeInsertRow(tab.id, localId) : undefined}
      onStageDelete={editable ? (rowKey, pkValues) => stageDelete(tab.id, rowKey, pkValues) : undefined}
    />
  )
}
```

- [ ] **Step 3: `Grid` コンポーネントの props 型を更新**

`Grid` 関数の props 型に追加:

```ts
import type { QueryResult, TableSort, RowEdit, PendingInsert } from '../../../shared/types'
import { rowKeyOf, pkValuesOf } from '../store/rowKey'

// Grid props
{
  // … 既存 props …
  inserts: PendingInsert[]
  deletes: Record<string, Record<string, unknown>>
  onUpdateInsert?: (localId: string, column: string, value: string) => void
  onRemoveInsert?: (localId: string) => void
  onStageDelete?: (rowKey: string, pkValues: Record<string, unknown>) => void
}
```

- [ ] **Step 4: `Grid` 内にコンテキストメニューの state を追加**

`Grid` 関数の冒頭（既存の `useState` の近く）に追加:

```ts
type CtxMenu =
  | { kind: 'existing'; x: number; y: number; rowKey: string; pkValues: Record<string, unknown> }
  | { kind: 'delete-staged'; x: number; y: number; rowKey: string; pkValues: Record<string, unknown> }
  | { kind: 'insert'; x: number; y: number; localId: string }

const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

// コンテキストメニューをページ外クリックで閉じる
useEffect(() => {
  if (!ctxMenu) return
  const close = (): void => setCtxMenu(null)
  document.addEventListener('mousedown', close)
  return () => document.removeEventListener('mousedown', close)
}, [ctxMenu])
```

※ `useEffect` を使うので `import { useMemo, useRef, useState, useEffect } from 'react'` に更新する。

- [ ] **Step 5: 既存行の `<tr>` に `onContextMenu` を追加し、DELETE ハイライトを適用**

既存の `table.getRowModel().rows.map((r) => ...)` 内の `<tr>` を以下に変更:

```tsx
const original = r.original as Row
const rowKey = editable ? rowKeyOf(primaryKey, original) : ''
const isDeleted = editable && rowKey in deletes
const rowEdit = editable ? edits[rowKey] : undefined

const handleContextMenu = (e: React.MouseEvent): void => {
  if (!editable) return
  e.preventDefault()
  onSelectRow?.(r.index)
  const pkVals = pkValuesOf(primaryKey, original)
  setCtxMenu(
    isDeleted
      ? { kind: 'delete-staged', x: e.clientX, y: e.clientY, rowKey, pkValues: pkVals }
      : { kind: 'existing', x: e.clientX, y: e.clientY, rowKey, pkValues: pkVals }
  )
}

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
    onContextMenu={handleContextMenu}
  >
    {/* … 既存のセルレンダリング … */}
  </tr>
)
```

- [ ] **Step 6: INSERT 行を `<tbody>` として追加**

`</tbody>` の後（`</table>` の前）に INSERT 行用の `<tbody>` を追加:

```tsx
{inserts.map((insert, insertIndex) => (
  <tbody key={insert.localId}>
    <tr
      className={styles.insertRow}
      onClick={onSelectRow ? () => onSelectRow(result.rows.length + insertIndex) : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelectRow?.(result.rows.length + insertIndex)
        setCtxMenu({ kind: 'insert', x: e.clientX, y: e.clientY, localId: insert.localId })
      }}
    >
      {result.columns.map((col) => {
        const value = insert.values[col.name]
        const colId = col.name
        const isEditingThis = editing?.rowKey === `insert-${insert.localId}` && editing?.column === colId

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
          <td key={colId} className={cls} onDoubleClick={editable ? startEdit : undefined}>
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
  </tbody>
))}
```

- [ ] **Step 7: コンテキストメニューの `<div>` を `gridWrap` 内に追加**

`</div>` (gridWrap 閉じタグ) の直前に追加:

```tsx
{ctxMenu && (
  <div
    className={styles.ctxMenu}
    style={{ top: ctxMenu.y, left: ctxMenu.x }}
    onMouseDown={(e) => e.stopPropagation()} // 外クリックで閉じる listener と干渉しないよう
  >
    {ctxMenu.kind === 'existing' && (
      <div
        className={`${styles.ctxItem} ${styles.ctxDanger}`}
        onClick={() => {
          onStageDelete?.(ctxMenu.rowKey, ctxMenu.pkValues)
          setCtxMenu(null)
        }}
      >
        行を削除
      </div>
    )}
    {ctxMenu.kind === 'delete-staged' && (
      <div
        className={styles.ctxItem}
        onClick={() => {
          onStageDelete?.(ctxMenu.rowKey, ctxMenu.pkValues)
          setCtxMenu(null)
        }}
      >
        削除を取り消す
      </div>
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
```

- [ ] **Step 8: 型チェックが通ることを確認**

```bash
npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: ResultsGrid に INSERT 行表示・DELETE ハイライト・右クリックメニューを追加"
```

---

## Task 5: EditBar のカウント表示を拡張

**Files:**
- Modify: `src/renderer/src/workspace/EditBar.tsx`

- [ ] **Step 1: `EditBar.tsx` を更新**

`EditBar` 内の `tab` 取得に `inserts` / `deletes` を追加し、表示ロジックを変更する。

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

  const updateCount = tab
    ? Object.values(tab.edits).reduce((n, e) => n + Object.keys(e.values).length, 0)
    : 0
  const insertCount = tab ? tab.inserts.length : 0
  const deleteCount = tab ? Object.keys(tab.deletes).length : 0
  const hasChanges = updateCount > 0 || insertCount > 0 || deleteCount > 0
  const tabId = tab?.id

  useEffect(() => {
    if (!tabId || !hasChanges) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void commitEdits(tabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabId, hasChanges, commitEdits])

  if (!tab || !hasChanges) return null

  // 変更の内訳を組み立てる（0件の種別は省略）
  const parts: string[] = []
  if (updateCount > 0) parts.push(`UPDATE ${updateCount} 件`)
  if (insertCount > 0) parts.push(`INSERT ${insertCount} 行`)
  if (deleteCount > 0) parts.push(`DELETE ${deleteCount} 行`)
  const summary = parts.join(' / ')

  return (
    <div className={styles.bar}>
      <span className={styles.count}>● 未コミットの変更: {summary}</span>
      {tab.editError && (
        <span className={styles.err}>
          {tab.editError.code}: {tab.editError.message}
        </span>
      )}
      <span className={styles.spacer} />
      <button disabled={tab.running} onClick={() => discardEdits(tab.id)}>
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

- [ ] **Step 2: 型チェックが通ることを確認**

```bash
npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/workspace/EditBar.tsx
git commit -m "feat: EditBar に INSERT/DELETE のカウントを表示"
```

---

## Task 6: DetailPane の INSERT 行選択対応

**Files:**
- Modify: `src/renderer/src/workspace/DetailPane.tsx`

- [ ] **Step 1: `DetailPane.tsx` に INSERT 行の判定と表示を追加**

`DetailPane` 関数内の `row` を求めるロジックの後に INSERT 判定を追加する。現在の `const row = ...` の行（25行目付近）の後:

```tsx
const result = tab.result
const index = tab.selectedRowIndex
const isInsertRow = index != null && result != null && index >= result.rows.length
const row = result && index != null && !isInsertRow
  ? (result.rows[index] as Row | undefined)
  : undefined
const editable = tab.primaryKey.length > 0
const rowKey = row && editable ? rowKeyOf(tab.primaryKey, row) : ''
const rowEdit = row && editable ? tab.edits[rowKey] : undefined
```

プレースホルダーの条件分岐（`!row || !result` の `<div>`）を更新:

```tsx
{isInsertRow ? (
  <div className={styles.placeholder}>新規行はグリッドで編集してください</div>
) : !row || !result ? (
  <div className={styles.placeholder}>行を選択してください</div>
) : (
  <div className={styles.body}>
    {/* … 既存のフィールドレンダリング … */}
  </div>
)}
```

- [ ] **Step 2: 型チェックが通ることを確認**

```bash
npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/renderer/src/workspace/DetailPane.tsx
git commit -m "feat: DetailPane で INSERT 行選択時に案内メッセージを表示"
```

---

## Task 7: 結合テストの追加（gated）

**Files:**
- Modify: `src/main/connection/ConnectionManager.integration.test.ts`

- [ ] **Step 1: INSERT / DELETE / 混合トランザクションのテストを追加**

`src/main/connection/ConnectionManager.integration.test.ts` の末尾（最後の `it` ブロックの後、外側の `describe` の閉じ括弧の前）に追加:

```ts
it('applyChanges: INSERT で行が増える', async () => {
  await mgr.query('DROP TABLE IF EXISTS ins_demo')
  await mgr.query('CREATE TABLE ins_demo (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50))')
  const res = await mgr.applyChanges([
    { sql: 'INSERT INTO `ins_demo` (`name`) VALUES (?)', params: ['太郎'] },
    { sql: 'INSERT INTO `ins_demo` (`name`) VALUES (?)', params: ['花子'] }
  ])
  expect(res.affectedRows).toBe(2)
  const after = await mgr.query('SELECT name FROM ins_demo ORDER BY id')
  expect(after.rows.map((r) => r.name)).toEqual(['太郎', '花子'])
})

it('applyChanges: DELETE で行が減る', async () => {
  await mgr.query('DROP TABLE IF EXISTS del_demo')
  await mgr.query('CREATE TABLE del_demo (id INT PRIMARY KEY, name VARCHAR(50))')
  await mgr.query('INSERT INTO del_demo (id, name) VALUES (1, "A"), (2, "B"), (3, "C")')
  const res = await mgr.applyChanges([
    { sql: 'DELETE FROM `del_demo` WHERE `id` = ?', params: [2] }
  ])
  expect(res.affectedRows).toBe(1)
  const after = await mgr.query('SELECT id FROM del_demo ORDER BY id')
  expect(after.rows.map((r) => r.id)).toEqual([1, 3])
})

it('applyChanges: DELETE + UPDATE + INSERT の混合が1トランザクションで適用される', async () => {
  await mgr.query('DROP TABLE IF EXISTS mix_demo')
  await mgr.query('CREATE TABLE mix_demo (id INT PRIMARY KEY, name VARCHAR(50))')
  await mgr.query('INSERT INTO mix_demo (id, name) VALUES (1, "A"), (2, "B")')
  await mgr.applyChanges([
    { sql: 'DELETE FROM `mix_demo` WHERE `id` = ?', params: [1] },         // delete id=1
    { sql: 'UPDATE `mix_demo` SET `name` = ? WHERE `id` = ?', params: ['BB', 2] }, // update id=2
    { sql: 'INSERT INTO `mix_demo` (id, name) VALUES (?, ?)', params: [3, 'C'] }   // insert id=3
  ])
  const after = await mgr.query('SELECT id, name FROM mix_demo ORDER BY id')
  expect(after.rows).toEqual([
    { id: 2, name: 'BB' },
    { id: 3, name: 'C' }
  ])
})

it('applyChanges: 混合の途中で失敗したら全ロールバック（INSERT/DELETE は適用されない）', async () => {
  await mgr.query('DROP TABLE IF EXISTS mix_rb')
  await mgr.query('CREATE TABLE mix_rb (id INT PRIMARY KEY, n INT NOT NULL)')
  await mgr.query('INSERT INTO mix_rb (id, n) VALUES (1, 10)')
  await expect(
    mgr.applyChanges([
      { sql: 'INSERT INTO `mix_rb` (id, n) VALUES (?, ?)', params: [2, 20] },
      { sql: 'UPDATE `mix_rb` SET `n` = ? WHERE `id` = ?', params: [null, 1] } // NOT NULL 違反
    ])
  ).rejects.toMatchObject({ code: 'ER_BAD_NULL_ERROR' })
  const after = await mgr.query('SELECT id FROM mix_rb ORDER BY id')
  expect(after.rows.map((r) => r.id)).toEqual([1]) // id=2 は挿入されていない
})
```

- [ ] **Step 2: 結合テストを実行して確認（Docker MySQL が必要）**

Docker MySQL を起動して実行:

```bash
docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=rootpw -e MYSQL_DATABASE=testdb -p 13306:3306 mysql:8
# しばらく待ってから:
TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts
```

Expected: すべて PASS（既存テスト含む）

停止:
```bash
docker stop mysql-test && docker rm mysql-test
```

- [ ] **Step 3: ユニットテストが全部通ることを確認**

```bash
npx vitest run
```

Expected: すべて PASS

- [ ] **Step 4: 型チェック & ビルド確認**

```bash
npx tsc --noEmit && npm run build
```

Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/main/connection/ConnectionManager.integration.test.ts
git commit -m "test: INSERT/DELETE/混合トランザクションの結合テストを追加"
```
