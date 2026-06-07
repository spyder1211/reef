# レコード詳細ペイン（右ペイン編集）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルビューで行を選択すると右ペインにレコードの全フィールドを縦並び表示し、ペイン上で編集（既存ステージング共有）できるようにする。各フィールドに mysql2 由来の型を表示する。

**Architecture:** `QueryColumn` に型名を持たせ（main で mysql2 のフィールド型コードを名前化）、ストアの `TableTab` に `selectedRowIndex`、アプリ状態に `detailOpen` を追加。新規 `DetailPane` がアクティブ行のフィールドを描画し、入力はライブ束縛で既存の `setCellEdit`/`setCellNull` に流す。`ResultsGrid` は行クリックで選択、`WorkspaceShell` は3カラム化、`StatusBar` にトグルを置く。`feat/cell-editing` の上に積む。

**Tech Stack:** Electron + React 18 + TypeScript / Zustand / @tanstack/react-table / mysql2 / Vitest / CSS Modules

**Spec:** `docs/superpowers/specs/2026-06-07-record-detail-pane-design.md`

---

## File Structure

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/shared/types.ts` | 変更 | `QueryColumn.type?` を追加 |
| `src/main/connection/mysqlTypes.ts`(+test) | 新規 | 型コード→名前（純粋） |
| `src/main/connection/ConnectionManager.ts` | 変更 | query で列型を付与 |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | 列型の結合テスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | selectedRowIndex / detailOpen / selectRow / toggleDetail / ナビでリセット |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | 行選択＋ハイライト |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | 選択行スタイル |
| `src/renderer/src/workspace/DetailPane.tsx`(+css) | 新規 | 詳細ペイン |
| `src/renderer/src/workspace/StatusBar.tsx` | 変更 | 詳細トグル |
| `src/renderer/src/workspace/StatusBar.module.css` | 変更 | トグルスタイル |
| `src/renderer/src/workspace/WorkspaceShell.tsx` | 変更 | 3カラム配線 |

---

## Task 1: 列の型情報（QueryColumn.type + mysqlTypes + query 付与）

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/connection/mysqlTypes.ts`
- Test: `src/main/connection/mysqlTypes.test.ts`
- Modify: `src/main/connection/ConnectionManager.ts`
- Test: `src/main/connection/ConnectionManager.integration.test.ts`

- [ ] **Step 1: QueryColumn に type を追加**

`src/shared/types.ts` の `QueryColumn` を次に置き換え:

```ts
export interface QueryColumn {
  name: string
  type?: string // mysql2 のフィールド型名（例: longlong / var_string / timestamp）。未取得は undefined
}
```

- [ ] **Step 2: mysqlTypes の失敗するテストを書く**

`src/main/connection/mysqlTypes.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import { fieldTypeName } from './mysqlTypes'

describe('fieldTypeName', () => {
  it('代表的な型コードを名前にする', () => {
    expect(fieldTypeName(8)).toBe('longlong')
    expect(fieldTypeName(253)).toBe('var_string')
    expect(fieldTypeName(7)).toBe('timestamp')
    expect(fieldTypeName(3)).toBe('long')
    expect(fieldTypeName(12)).toBe('datetime')
    expect(fieldTypeName(10)).toBe('date')
  })
  it('未知コードは type<code> でフォールバック', () => {
    expect(fieldTypeName(999)).toBe('type999')
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/mysqlTypes.test.ts`
Expected: FAIL（`./mysqlTypes` が存在しない）

- [ ] **Step 4: mysqlTypes.ts を実装**

`src/main/connection/mysqlTypes.ts` を新規作成:

```ts
// mysql2 のフィールド型コード → 表示用の型名。未知コードは `type<code>`。
const NAMES: Record<number, string> = {
  0: 'decimal',
  1: 'tiny',
  2: 'short',
  3: 'long',
  4: 'float',
  5: 'double',
  6: 'null',
  7: 'timestamp',
  8: 'longlong',
  9: 'int24',
  10: 'date',
  11: 'time',
  12: 'datetime',
  13: 'year',
  15: 'varchar',
  16: 'bit',
  245: 'json',
  246: 'newdecimal',
  247: 'enum',
  248: 'set',
  249: 'tiny_blob',
  250: 'medium_blob',
  251: 'long_blob',
  252: 'blob',
  253: 'var_string',
  254: 'string',
  255: 'geometry'
}

export function fieldTypeName(code: number): string {
  return NAMES[code] ?? `type${code}`
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/main/connection/mysqlTypes.test.ts`
Expected: PASS

- [ ] **Step 6: ConnectionManager.query で列型を付与**

`src/main/connection/ConnectionManager.ts` の先頭付近、`import { extractTableNames } from './extractTableNames'` の直後に追加:

```ts
import { fieldTypeName } from './mysqlTypes'
```

`query` メソッド内の列マッピング行（現状）:

```ts
    const columns = (fields ?? []).map((f) => ({ name: (f as { name: string }).name }))
```

を次に置き換え:

```ts
    const columns = (fields ?? []).map((f) => {
      const ff = f as { name: string; type?: number }
      return { name: ff.name, type: typeof ff.type === 'number' ? fieldTypeName(ff.type) : undefined }
    })
```

- [ ] **Step 7: 結合テストを追記**

`src/main/connection/ConnectionManager.integration.test.ts` の最後の `it(...)` ブロックの**閉じ括弧 `})` の直後**（`describe` を閉じる `})` の直前）に追加:

```ts

  it('query は columns に mysql2 の型名を付与する', async () => {
    await mgr.query('DROP TABLE IF EXISTS type_demo')
    await mgr.query('CREATE TABLE type_demo (id INT, name VARCHAR(50), created_at TIMESTAMP NULL)')
    const res = await mgr.query('SELECT id, name, created_at FROM type_demo')
    const byName = Object.fromEntries(res.columns.map((c) => [c.name, c.type]))
    expect(byName.id).toBe('long')
    expect(byName.name).toBe('var_string')
    expect(byName.created_at).toBe('timestamp')
  })
```

- [ ] **Step 8: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`

- [ ] **Step 9: 結合テストを実行（docker 起動済みの場合）**

Run: `docker compose -f docker-compose.test.yml up -d` → 必要なら `sleep 8` → `TEST_MYSQL_HOST=127.0.0.1 npx vitest run src/main/connection/ConnectionManager.integration.test.ts`
Expected: 全 PASS（新規 1 件含む）。docker が無ければ skip でも可。実行後は `docker compose -f docker-compose.test.yml down`。

- [ ] **Step 10: 既存ユニットが緑であることを確認**

Run: `npm test`
Expected: 全ユニット PASS（結合 skip）

- [ ] **Step 11: コミット**

```bash
git add src/shared/types.ts src/main/connection/mysqlTypes.ts src/main/connection/mysqlTypes.test.ts src/main/connection/ConnectionManager.ts src/main/connection/ConnectionManager.integration.test.ts
git commit -m "feat: QueryColumn に mysql2 由来の型名を付与 (mysqlTypes, TDD)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ストア（選択 + 詳細ペイン表示状態）

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

検証は型チェック + 既存ユニット。

- [ ] **Step 1: TableTab に selectedRowIndex を追加**

`export interface TableTab extends BaseTab { ... }` の `editError: AppError | null` 行の直後に追加:

```ts
  selectedRowIndex: number | null // 現在ページ内で選択中の行インデックス。null = 未選択
```

- [ ] **Step 2: makeTableTab を更新**

`makeTableTab` の `editError: null,` 行の直後に追加:

```ts
    selectedRowIndex: null,
```

- [ ] **Step 3: AppState に detailOpen / selectRow / toggleDetail を追加**

`interface AppState { ... }` の `activeTabId: string | null` 行の直後に追加:

```ts
  detailOpen: boolean
```

同 `interface AppState` 内、`commitEdits: (tabId: string) => Promise<void>` の行の直後に追加:

```ts
  selectRow: (tabId: string, index: number) => void
  toggleDetail: () => void
```

- [ ] **Step 4: 初期状態に detailOpen を追加**

返却オブジェクトの先頭、`activeTabId: null,` 行の直後に追加:

```ts
    detailOpen: true,
```

- [ ] **Step 5: ナビゲーション系アクションで selectedRowIndex をリセット**

`applyFilters` / `setSort` / `setPage` / `setPageSize` の `patchTableTab(...)` のオブジェクトに、それぞれ `selectedRowIndex: null` を追加する。具体的には次の4箇所を置き換え:

`applyFilters` 内:
```ts
      patchTableTab(tabId, (t) => ({ ...t, page: 0, edits: {}, editError: null }))
```
→
```ts
      patchTableTab(tabId, (t) => ({ ...t, page: 0, edits: {}, editError: null, selectedRowIndex: null }))
```

`setSort` 内:
```ts
      patchTableTab(tabId, (t) => ({
        ...t,
        sort: cycleSort(t.sort, column),
        page: 0,
        edits: {},
        editError: null
      }))
```
→
```ts
      patchTableTab(tabId, (t) => ({
        ...t,
        sort: cycleSort(t.sort, column),
        page: 0,
        edits: {},
        editError: null,
        selectedRowIndex: null
      }))
```

`setPage` 内:
```ts
      patchTableTab(tabId, (t) => ({ ...t, page: Math.max(0, page), edits: {}, editError: null }))
```
→
```ts
      patchTableTab(tabId, (t) => ({ ...t, page: Math.max(0, page), edits: {}, editError: null, selectedRowIndex: null }))
```

`setPageSize` 内:
```ts
      patchTableTab(tabId, (t) => ({ ...t, pageSize: safe, page: 0, edits: {}, editError: null }))
```
→
```ts
      patchTableTab(tabId, (t) => ({ ...t, pageSize: safe, page: 0, edits: {}, editError: null, selectedRowIndex: null }))
```

- [ ] **Step 6: selectRow / toggleDetail アクションを追加**

返却オブジェクトの末尾、`commitEdits` アクションの閉じ `}` の直後にカンマを付け、次の2アクションを追加（`toggleDetail` が末尾＝カンマ不要）:

```ts
,

    selectRow(tabId, index) {
      patchTableTab(tabId, (t) => ({ ...t, selectedRowIndex: index }))
    },

    toggleDetail() {
      set({ detailOpen: !get().detailOpen })
    }
```

注: `commitEdits` は現在オブジェクトの最後のプロパティ（末尾カンマなし）。その閉じ `}` の後に `,` を補ってから上記2アクションを続けること。

- [ ] **Step 7: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 8: 既存ユニットが緑であることを確認**

Run: `npm test`
Expected: 全ユニット PASS（結合 skip）

- [ ] **Step 9: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: 行選択(selectedRowIndex)と詳細ペイン表示状態(detailOpen)をストアに追加

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ResultsGrid の行選択

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

- [ ] **Step 1: ResultsGrid.tsx を全置換**

```tsx
import { useMemo, useRef, useState } from 'react'
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
  const selectRow = useAppStore((s) => s.selectRow)

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
      selectedRowIndex={selectedRowIndex}
      onSelectRow={onSelectRow}
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
  selectedRowIndex,
  onSelectRow,
  onEdit,
  onNull
}: {
  result: QueryResult
  sort: TableSort | null
  onSort?: (column: string) => void
  editable: boolean
  primaryKey: string[]
  edits: Record<string, RowEdit>
  selectedRowIndex: number | null
  onSelectRow?: (index: number) => void
  onEdit?: (row: Row, column: string, value: string) => void
  onNull?: (row: Row, column: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState<{ rowKey: string; column: string } | null>(null)
  const [draft, setDraft] = useState('')
  // Enter/Esc 確定後に trailing blur が再度 confirm するのを防ぐ（編集開始ごとにリセット）
  const committedRef = useRef(false)

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
              <tr
                key={r.id}
                className={r.index === selectedRowIndex ? styles.selected : undefined}
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

- [ ] **Step 2: ResultsGrid.module.css に選択行スタイルを追記**

ファイル末尾に追加:

```css
.grid tbody tr.selected td {
  background: #e6f0ff;
}
```

> 注: `.dirty` / `.editing` は `background` に `!important` が付いているため、選択行内でも変更済み/編集中セルの色がセル単位で優先される（両立）。

- [ ] **Step 3: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: 結果グリッドの行クリックで選択＋ハイライト

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: DetailPane コンポーネント

**Files:**
- Create: `src/renderer/src/workspace/DetailPane.tsx`
- Create: `src/renderer/src/workspace/DetailPane.module.css`

- [ ] **Step 1: DetailPane.tsx を新規作成**

```tsx
import { useAppStore } from '../store/useAppStore'
import { rowKeyOf } from '../store/rowKey'
import styles from './DetailPane.module.css'

type Row = Record<string, unknown>

export default function DetailPane(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const toggleDetail = useAppStore((s) => s.toggleDetail)

  if (!tab) return null

  const result = tab.result
  const index = tab.selectedRowIndex
  const row = result && index != null ? (result.rows[index] as Row | undefined) : undefined
  const editable = tab.primaryKey.length > 0

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <span>レコード詳細</span>
        <button className={styles.close} onClick={() => toggleDetail()} title="閉じる">
          ✕
        </button>
      </div>
      {!row || !result ? (
        <div className={styles.placeholder}>行を選択してください</div>
      ) : (
        <div className={styles.body}>
          {result.columns.map((col) => {
            const rowKey = editable ? rowKeyOf(tab.primaryKey, row) : ''
            const rowEdit = editable ? tab.edits[rowKey] : undefined
            const isDirty = rowEdit ? col.name in rowEdit.values : false
            const value = isDirty ? rowEdit!.values[col.name] : (row[col.name] as unknown)
            const isNull = value === null || value === undefined
            const text = isNull ? '' : String(value)
            const long = text.length > 40
            const inputCls = [styles.val, isDirty ? styles.dirty : ''].filter(Boolean).join(' ')
            return (
              <div key={col.name} className={styles.field}>
                <div className={styles.fhead}>
                  <span className={styles.fname}>{col.name}</span>
                  {col.type && <span className={styles.ftype}>{col.type}</span>}
                </div>
                {long ? (
                  <textarea
                    className={`${inputCls} ${styles.area}`}
                    value={text}
                    disabled={!editable}
                    onChange={(e) => setCellEdit(tab.id, row, col.name, e.target.value)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    value={text}
                    disabled={!editable}
                    placeholder={isNull ? 'NULL' : ''}
                    onChange={(e) => setCellEdit(tab.id, row, col.name, e.target.value)}
                  />
                )}
                {editable && (
                  <div className={styles.nullRow}>
                    {isNull && <span className={styles.nullTag}>NULL</span>}
                    <button
                      className={styles.nullBtn}
                      onClick={() => setCellNull(tab.id, row, col.name)}
                    >
                      NULL に設定
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: DetailPane.module.css を新規作成**

```css
.pane {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
}
.close {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 12px;
}
.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 12px;
}
.body {
  overflow-y: auto;
  padding: 4px 12px 16px;
}
.field {
  padding: 8px 0 10px;
  border-bottom: 1px solid var(--border-soft);
}
.fhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 4px;
}
.fname {
  font-weight: 600;
  font-size: 12px;
  color: var(--text);
}
.ftype {
  font-size: 10px;
  color: var(--text-faint);
}
.val {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  font: 12px -apple-system, sans-serif;
  background: #fff;
  color: var(--text);
}
.val:disabled {
  background: var(--row-alt);
  color: var(--text-muted);
}
.dirty {
  background: #fff3cd;
  border-color: #ffcf33;
}
.area {
  min-height: 48px;
  resize: vertical;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.nullRow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.nullTag {
  font-size: 10px;
  color: var(--text-faint);
  font-style: italic;
}
.nullBtn {
  font-size: 9px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-sidebar);
  color: var(--text-muted);
  cursor: pointer;
}
```

- [ ] **Step 3: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`（DetailPane はまだ未配線でも単体でコンパイルが通る）

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/workspace/DetailPane.tsx src/renderer/src/workspace/DetailPane.module.css
git commit -m "feat: レコード詳細ペイン DetailPane を追加（フィールド縦並び・型・編集・NULL）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: StatusBar トグル + WorkspaceShell 配線

**Files:**
- Modify: `src/renderer/src/workspace/StatusBar.tsx`
- Modify: `src/renderer/src/workspace/StatusBar.module.css`
- Modify: `src/renderer/src/workspace/WorkspaceShell.tsx`

- [ ] **Step 1: StatusBar.tsx を全置換**

```tsx
import { useAppStore } from '../store/useAppStore'
import { TAG_COLORS } from '../lib/tags'
import styles from './StatusBar.module.css'

export default function StatusBar(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const profile = useAppStore((s) => s.activeProfile)
  const detailOpen = useAppStore((s) => s.detailOpen)
  const toggleDetail = useAppStore((s) => s.toggleDetail)
  const r = tab?.result
  const isTable = tab?.kind === 'table'

  return (
    <div className={styles.status}>
      <span>{r ? `${r.rowCount} 行 · ${r.durationMs} ms` : '—'}</span>
      <span className={styles.right}>
        {isTable && (
          <button
            className={detailOpen ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
            onClick={() => toggleDetail()}
            title="詳細ペインの表示切り替え"
          >
            ▦ 詳細
          </button>
        )}
        <span className={styles.dot} style={{ background: TAG_COLORS[profile?.tag ?? 'none'] }} />
        {profile?.name}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: StatusBar.module.css にトグルスタイルを追記**

ファイル末尾に追加:

```css
.toggle {
  font-size: 11px;
  padding: 1px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.toggleOn {
  background: #eef4ff;
  border-color: #2f7bf6;
  color: #2f7bf6;
}
```

- [ ] **Step 3: WorkspaceShell.tsx を全置換**

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
import DetailPane from './DetailPane'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
  const activeKind = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t?.kind ?? null
  })
  const detailOpen = useAppStore((s) => s.detailOpen)

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
      {detailOpen && activeKind === 'table' && <DetailPane />}
    </div>
  )
}
```

- [ ] **Step 4: 型チェック + ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし、`✓ built`

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/StatusBar.tsx src/renderer/src/workspace/StatusBar.module.css src/renderer/src/workspace/WorkspaceShell.tsx
git commit -m "feat: 詳細ペインのトグル(StatusBar)と3カラム配線(WorkspaceShell)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完了後の最終確認

- [ ] `npm run typecheck` — エラーなし
- [ ] `npm test` — 全ユニット PASS（結合 skip）
- [ ] `npm run build` — `✓ built`
- [ ] （任意）docker 結合テスト: 列型テストを含め PASS
- [ ] 手動確認（**main を変更したため `npm run dev` を完全再起動 → 接続し直し**）:
  - テーブルを開く → 右に詳細ペイン（既定表示）。行をクリック → 選択ハイライト＋ペインにフィールド縦並び＋型表示。
  - ペインの入力を変更 → 黄色ハイライト＋グリッドの該当セルも変更扱い＋ EditBar に合算 → ⌘S でコミット。
  - 「NULL に設定」で NULL、元値に戻すとハイライト解除。
  - 主キーなしテーブル: ペインは表示専用（入力 disabled）。
  - ステータスバーの「▦ 詳細」でペイン表示/非表示、ペインの ✕ でも閉じる。
  - ページ送り/ソート/フィルタで選択解除。コミット後は選択維持。

> **注:** main（ConnectionManager 等）を変更したため `npm run dev` は完全停止 → 再起動が必須。

---

## 既知の制約（spec §6 より）

- SQL タブはペイン対象外（将来読み取り専用で拡張余地）。
- 選択は単一行・カレントページ内（ページ移動・ソート・フィルタで解除）。
- 値入力は文字列ベース（mysql2 が列型に変換）。NULL は「NULL に設定」ボタンで明示。
