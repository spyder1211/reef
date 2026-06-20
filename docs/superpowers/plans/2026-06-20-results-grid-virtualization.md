# ResultsGrid 行仮想化（P1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ResultsGrid` の結果行を全件 DOM 化から「可視ウィンドウ＋オーバースキャンのみ描画」する縦方向仮想化に置き換え、行数に依らず DOM ノード数を一定に保つ。

**Architecture:** `<table>` 構造（`border-collapse`・sticky `<thead>`・`<colgroup>`）を維持したまま、(1) カラム幅を内容から実測して `table-layout: fixed` ＋ `<colgroup>` で固定し、(2) 結果 `<tbody>` を「上スペーサ `<tr>`／可視ウィンドウ行／下スペーサ `<tr>`」に置き換える。仮想化は `@tanstack/react-virtual` の `useVirtualizer`、行モデルは既存の `@tanstack/react-table` を継続使用（`vi.index` でインデックスし、セル描画ロジックは無改変）。

**Tech Stack:** React 18 + TypeScript / Zustand / `@tanstack/react-table`（導入済み）/ `@tanstack/react-virtual`（本計画で追加）/ Vitest / CSS Modules。

## Global Constraints

- **renderer 限定の変更**。main・preload・IPC・store には触れない（仮想化は描画層のみ）。
- 既存インタラクション（行選択クリック/Shift/⌘/⌘A・矢印キー移動＋自動スクロール・セル編集ダブルクリック・右クリックメニュー・quick filter・INSERT 行・削除ステージング・複製・コピー）を**すべて維持**する。
- **`ROW_HEIGHT`（JS 定数 = 25）と結果行の実 CSS 行高は必ず一致**させる。ズレると仮想化のスペーサ高さが累積ドリフトしてスクロールが破綻する。CSS は `box-sizing: border-box` ＋固定 `height` で行高を確定させる。
- レイアウト定数: `ROW_HEIGHT = 25` / `MIN_COL_WIDTH = 48` / `MAX_COL_WIDTH = 480` / サンプル行数 `200` / セルパディング余白 `24`。
- `@tanstack/react-virtual` は `devDependencies` に追加（既存 `@tanstack/react-table` と同じ扱い）。
- 既存パターン踏襲: `default export` の関数コンポーネント、`JSX.Element` 返却、CSS Modules（`styles.*`）。
- カラム幅エスティメータは**純関数**（`measure` 注入）でユニットテスト可能にする。canvas 等の DOM 依存は呼び出し側（`ResultsGrid.tsx`）に置く。

---

### Task 1: カラム幅エスティメータ（純関数 ＋ レイアウト定数）

仮想化の前提となる「内容から実測した列幅」を計算する純関数と、レイアウト定数を新規ファイルに切り出す。`measure` 関数を注入することで DOM 非依存にし、Vitest でユニットテストする。

**Files:**
- Create: `src/renderer/src/workspace/columnWidths.ts`
- Test: `src/renderer/src/workspace/columnWidths.test.ts`

**Interfaces:**
- Produces:
  - `export const ROW_HEIGHT = 25`
  - `export const MIN_COL_WIDTH = 48`
  - `export const MAX_COL_WIDTH = 480`
  - `export function estimateColumnWidths(columns: { name: string }[], rows: Record<string, unknown>[], measure: (text: string) => number, opts?: { sampleRows?: number; minWidth?: number; maxWidth?: number; padding?: number }): number[]`
    - 戻り値: 各列の固定幅（px、整数）。`columns` と同じ長さ・同じ順序。
    - 計測対象テキスト: ヘッダ `col.name` ＋ 先頭 `sampleRows`（既定 200）行のセル値。`null`/`undefined` は `"NULL"`、その他は `String(value)`。
    - 各列で計測の最大値に `padding`（既定 24）を加え、`[minWidth, maxWidth]` でクランプし `Math.round`。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/workspace/columnWidths.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estimateColumnWidths, MIN_COL_WIDTH, MAX_COL_WIDTH, ROW_HEIGHT } from './columnWidths'

// 1文字 = 10px の決定論的フェイク計測器
const measure = (text: string): number => text.length * 10

describe('estimateColumnWidths', () => {
  it('列が無ければ空配列を返す', () => {
    expect(estimateColumnWidths([], [], measure)).toEqual([])
  })

  it('行が無ければヘッダ幅から算出する（パディング加算＋下限クランプ）', () => {
    // measure('id') = 20, +padding(24) = 44, 下限48でクランプ
    expect(estimateColumnWidths([{ name: 'id' }], [], measure)).toEqual([MIN_COL_WIDTH])
    // measure('description') = 110, +24 = 134
    expect(estimateColumnWidths([{ name: 'description' }], [], measure)).toEqual([134])
  })

  it('サンプル行の最大セル幅を採用する（ヘッダより長いセル）', () => {
    const cols = [{ name: 'name' }] // measure('name') = 40
    const rows = [{ name: 'short' }, { name: 'a-very-long-value' }] // 50, 170
    // 最大170 +24 = 194
    expect(estimateColumnWidths(cols, rows, measure)).toEqual([194])
  })

  it('sampleRows を超える行は無視する', () => {
    const cols = [{ name: 'c' }] // 10
    const rows = [{ c: 'x' }, { c: 'WAY-TOO-LONG-IGNORED' }] // index0=10, index1=200
    // sampleRows=1 なら index0 のみ: max(10, header10)=10, +24=34, 下限48
    expect(estimateColumnWidths(cols, rows, measure, { sampleRows: 1 })).toEqual([MIN_COL_WIDTH])
  })

  it('上限でクランプする', () => {
    const cols = [{ name: 'big' }]
    const rows = [{ big: 'x'.repeat(100) }] // 1000px
    expect(estimateColumnWidths(cols, rows, measure)).toEqual([MAX_COL_WIDTH])
  })

  it('null/undefined は "NULL"(4文字) として計測する', () => {
    const cols = [{ name: 'v' }] // header 'v' = 10
    const rows = [{ v: null }, { v: undefined }] // 'NULL' = 40 each
    // 最大40 +24 = 64
    expect(estimateColumnWidths(cols, rows, measure)).toEqual([64])
  })

  it('ROW_HEIGHT は仮想化用に 25 で固定', () => {
    expect(ROW_HEIGHT).toBe(25)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/renderer/src/workspace/columnWidths.test.ts`
Expected: FAIL（`columnWidths` モジュール未作成で import エラー）

- [ ] **Step 3: 実装を書く**

`src/renderer/src/workspace/columnWidths.ts`:

```ts
// 結果行の固定行高（px）。ResultsGrid.module.css の結果セル height と必ず一致させること。
// 仮想化のスペーサ高さがこの値を基準に計算されるため、ズレるとスクロールが破綻する。
export const ROW_HEIGHT = 25

export const MIN_COL_WIDTH = 48 // 列幅の下限（px）
export const MAX_COL_WIDTH = 480 // 列幅の上限（px）。超過分はセル内 ellipsis 省略

const DEFAULT_SAMPLE_ROWS = 200 // 幅計測に使う先頭サンプル行数
const DEFAULT_PADDING = 24 // td 左右パディング相当の余白（px）

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  return String(value)
}

/**
 * 各列の固定幅を内容から実測して算出する純関数。
 * `measure` は注入（実行時は canvas measureText、テストはフェイク計測器）。
 * ヘッダ＋先頭 sampleRows 行のセル文字幅の最大値に padding を加え、[minWidth, maxWidth] でクランプ。
 */
export function estimateColumnWidths(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  measure: (text: string) => number,
  opts?: { sampleRows?: number; minWidth?: number; maxWidth?: number; padding?: number }
): number[] {
  const sampleRows = opts?.sampleRows ?? DEFAULT_SAMPLE_ROWS
  const minWidth = opts?.minWidth ?? MIN_COL_WIDTH
  const maxWidth = opts?.maxWidth ?? MAX_COL_WIDTH
  const padding = opts?.padding ?? DEFAULT_PADDING
  const sampleCount = Math.min(rows.length, sampleRows)

  return columns.map((col) => {
    let widest = measure(col.name)
    for (let i = 0; i < sampleCount; i++) {
      const w = measure(cellText(rows[i][col.name]))
      if (w > widest) widest = w
    }
    const withPadding = widest + padding
    return Math.round(Math.max(minWidth, Math.min(maxWidth, withPadding)))
  })
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/workspace/columnWidths.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/workspace/columnWidths.ts src/renderer/src/workspace/columnWidths.test.ts
git commit -m "feat(grid): カラム幅エスティメータと仮想化用レイアウト定数"
```

---

### Task 2: カラム幅を実測固定で適用（colgroup ＋ table-layout: fixed）

`Grid` に実測カラム幅を `<colgroup>` ＋ `table-layout: fixed` で適用する。この時点では全行を描画したまま（仮想化は Task 3）。固定幅超過のセルは ellipsis 省略にする。**行高を `box-sizing: border-box` ＋ `height: 25px` で確定**させ、Task 3 の仮想化に備える。

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

**Interfaces:**
- Consumes: `estimateColumnWidths`, `ROW_HEIGHT`（Task 1）。
- Produces: `Grid` 内ローカル `const colWidths: number[]` と canvas ベースの `measure`。Task 3 はこの `colWidths`/`<colgroup>`/`table-layout: fixed` を前提に仮想化する。

- [ ] **Step 1: エスティメータと定数を import する**

`ResultsGrid.tsx` の import 群（15行目 `import { DEFAULT_SQL_LIMIT, MAX_RESULT_ROWS } ...` の直後）に追加:

```tsx
import { estimateColumnWidths, ROW_HEIGHT } from './columnWidths'
```

（`ROW_HEIGHT` は Task 2 では未使用でも Task 3 で使う。Task 2 では `estimateColumnWidths` のみ使うため、Task 2 のコミット時点で未使用 import を避けたい場合は `estimateColumnWidths` のみ import し、Task 3 で `ROW_HEIGHT` を追加してもよい。本計画では Task 2 で `estimateColumnWidths` のみ import する。）

実際に Task 2 で追加する import:

```tsx
import { estimateColumnWidths } from './columnWidths'
```

- [ ] **Step 2: `Grid` 内で実測カラム幅を計算する**

`Grid` 関数内、`const table = useReactTable({...})`（現 248-252行）の**直後**に追加:

```tsx
  // カラム幅を内容から実測して固定する（仮想化でスクロール時に max-content が再計算され
  // 幅がガタつくのを防ぐ）。canvas measureText を注入し、estimateColumnWidths は純関数のまま保つ。
  const colWidths = useMemo(() => {
    const family =
      typeof document !== 'undefined'
        ? getComputedStyle(document.body).fontFamily || 'sans-serif'
        : 'sans-serif'
    const ctx = document.createElement('canvas').getContext('2d')
    // セルは .grid の font-size: 12px で描画される
    const font = `12px ${family}`
    const measure = ctx
      ? (text: string): number => {
          ctx.font = font
          return ctx.measureText(text).width
        }
      : (text: string): number => text.length * 7 // canvas 不可時の粗い近似
    return estimateColumnWidths(result.columns, result.rows as Row[], measure)
  }, [result.columns, result.rows])

  const totalWidth = useMemo(() => colWidths.reduce((sum, w) => sum + w, 0), [colWidths])
```

- [ ] **Step 3: `<table>` に固定幅・`<colgroup>` を適用する**

現 289行 `<table className={styles.grid}>` を、テーブル全幅を実測合計に固定し `<colgroup>` を先頭に持つ形へ変更:

```tsx
      <table className={styles.grid} style={{ width: totalWidth }}>
        <colgroup>
          {result.columns.map((c, i) => (
            <col key={c.name} style={{ width: colWidths[i] }} />
          ))}
        </colgroup>
        <thead>
```

（`</thead>` 以降は変更しない。）

- [ ] **Step 4: CSS を固定レイアウト・固定行高・ellipsis へ変更する**

`ResultsGrid.module.css`。

(a) `.grid`（現 6-11行）を `table-layout: fixed` にし、`width: max-content` を撤去（幅は inline style で指定）:

```css
.grid {
  border-collapse: collapse;
  font-size: 12px;
  table-layout: fixed;
  min-width: 100%;
}
```

(b) `.grid td`（現 25-31行）を固定行高（border-box）＋ ellipsis 省略に変更:

```css
.grid td {
  height: 25px; /* = ROW_HEIGHT (columnWidths.ts)。仮想化のスペーサ計算と一致必須 */
  box-sizing: border-box;
  padding: 4px 12px; /* 上下4 + line 16 + border-bottom 1 = 25 */
  line-height: 16px;
  border-bottom: 1px solid var(--border-soft);
  border-right: 1px solid var(--border-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
```

(c) `.editing`（現 73-77行）に `overflow: visible` を足し、固定幅セルでも編集 input / NULL ボタンが見切れないようにする:

```css
.editing {
  background: var(--bg) !important;
  box-shadow: inset 0 0 0 2px var(--accent);
  padding: 2px 8px;
  overflow: visible;
}
```

- [ ] **Step 5: typecheck と build で検証**

Run: `npm run typecheck`
Expected: エラーなし

Run: `npm run build`
Expected: 成功（renderer バンドル生成）

- [ ] **Step 6: 既存テストが緑のままか確認**

Run: `npx vitest run`
Expected: 既存テスト全 PASS（このタスクはユニットテスト追加なし。挙動退行がないことの確認）

- [ ] **Step 7: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat(grid): カラム幅を実測固定で適用（colgroup + table-layout fixed）"
```

---

### Task 3: 結果行の仮想化（react-virtual ＋ スペーサ ＋ 偶奇ストライプ ＋ scrollToIndex）

結果 `<tbody>` を可視ウィンドウ＋上下スペーサに置き換える。`@tanstack/react-virtual` を導入し、`useVirtualizer` で可視範囲を算出。`:nth-child(even)` ストライプは窓化で破綻するためインデックス偶奇クラスへ、矢印キーの `scrollIntoView` は `scrollToIndex` へ置換する。INSERT 用 `<tbody>` は非仮想化のまま。

**Files:**
- Modify: `package.json`（`+@tanstack/react-virtual`）
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`

**Interfaces:**
- Consumes: `colWidths`, `<colgroup>`, `table-layout: fixed`（Task 2）/ `ROW_HEIGHT`（Task 1）/ 既存 `gridWrapRef`（`.gridWrap` スクロールコンテナ）/ 既存 `table.getRowModel()`（react-table 行モデル）。

- [ ] **Step 1: 依存を追加する**

Run: `npm install -D @tanstack/react-virtual`
Expected: `package.json` の `devDependencies` に `@tanstack/react-virtual` が追加され、`package-lock.json` 更新。

- [ ] **Step 2: import を追加する**

`ResultsGrid.tsx` 冒頭付近に追加（react-table の import 群の近く）:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
```

Task 2 で `estimateColumnWidths` のみ import していた行を、`ROW_HEIGHT` も含む形に更新:

```tsx
import { estimateColumnWidths, ROW_HEIGHT } from './columnWidths'
```

- [ ] **Step 3: virtualizer を生成する（早期 return より前）**

`Grid` 内、`const totalWidth = useMemo(...)`（Task 2 で追加）の**直後**、かつ `if (result.columns.length === 0) return ...`（現 254行）より**前**に追加する。フック順序を崩さないため早期 return より前であることが必須:

```tsx
  const rowVirtualizer = useVirtualizer({
    count: result.rows.length,
    getScrollElement: () => gridWrapRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })
```

- [ ] **Step 4: 結果 `<tbody>` を仮想化版に置き換える**

現 313-422行の結果行 `<tbody>`（`{table.getRowModel().rows.map((r) => {...})}` を含むブロック、INSERT 用 `<tbody>` の手前まで）を、以下に置き換える。**行レンダリングの中身（`startEdit`/`confirm`/`cancel`/`setNull`/セル描画の JSX）は現状をそのまま保持**し、外側の繰り返しとスペーサ・行クラスのみ変更する:

```tsx
        <tbody>
          {(() => {
            const rows = table.getRowModel().rows
            const virtualItems = rowVirtualizer.getVirtualItems()
            const totalSize = rowVirtualizer.getTotalSize()
            const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
            const paddingBottom =
              virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0

            return (
              <>
                {paddingTop > 0 && (
                  <tr aria-hidden="true">
                    <td className={styles.spacer} colSpan={result.columns.length} style={{ height: paddingTop }} />
                  </tr>
                )}
                {virtualItems.map((vi) => {
                  const r = rows[vi.index]
                  const original = r.original as Row
                  const rowKey = editable ? rowKeyOf(primaryKey, original) : ''
                  const isDeleted = editable && rowKey in deletes
                  const rowEdit = editable ? edits[rowKey] : undefined

                  const stripe = vi.index % 2 === 1 ? styles.rowAlt : ''
                  const state = isDeleted
                    ? styles.deleteRow
                    : selectedSet.has(r.index)
                      ? styles.selected
                      : ''
                  const rowCls = [stripe, state].filter(Boolean).join(' ') || undefined

                  return (
                    <tr
                      key={r.id}
                      className={rowCls}
                      onMouseDown={(e) => handleRowMouseDown(r.index, e)}
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
                                    if (!selectedSet.has(r.index)) onSetSelection?.([r.index], r.index)
                                    setCtxMenu({
                                      kind: 'cell',
                                      x: e.clientX,
                                      y: e.clientY,
                                      column: colId,
                                      value: original[colId]
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
                {paddingBottom > 0 && (
                  <tr aria-hidden="true">
                    <td className={styles.spacer} colSpan={result.columns.length} style={{ height: paddingBottom }} />
                  </tr>
                )}
              </>
            )
          })()}
        </tbody>
```

注意:
- `data-row-index` 属性は撤去した（Step 6 で `scrollIntoView` を `scrollToIndex` に置換し、唯一の消費者が消えるため）。
- ストライプは `vi.index % 2 === 1`（= 旧 `:nth-child(even)` と同じ行）に `styles.rowAlt` を付与。`selected`/`deleteRow` の td 背景がその上に塗られるため見た目は不変。

- [ ] **Step 5: 矢印キーのスクロールを `scrollToIndex` に置換する**

現 282-285行の以下を:

```tsx
          onSetSelection(next.indices, next.anchor)
          // アクティブ行を可視領域へスクロール
          gridWrapRef.current
            ?.querySelector(`tr[data-row-index="${next.lead}"]`)
            ?.scrollIntoView({ block: 'nearest' })
```

次に置換:

```tsx
          onSetSelection(next.indices, next.anchor)
          // アクティブ行を可視領域へスクロール（仮想化のため未マウント行にも対応）
          rowVirtualizer.scrollToIndex(next.lead, { align: 'auto' })
```

- [ ] **Step 6: CSS にスペーサと偶奇クラスを追加し、`:nth-child` を撤去する**

`ResultsGrid.module.css`:

(a) `.grid tbody tr:nth-child(even)`（現 32-34行）を**削除**し、代わりにインデックス偶奇クラスを追加:

```css
.rowAlt {
  background: var(--row-alt);
}
```

(b) スペーサ行セルのスタイルを追加（パディング・ボーダーを消し、高さは inline style に委ねる）。`.grid td` より高い詳細度にするため `.grid td.spacer` で記述:

```css
.grid td.spacer {
  padding: 0;
  border: none;
  height: auto;
}
```

- [ ] **Step 7: typecheck と build で検証**

Run: `npm run typecheck`
Expected: エラーなし

Run: `npm run build`
Expected: 成功

- [ ] **Step 8: 既存テストが緑のままか確認**

Run: `npx vitest run`
Expected: 全 PASS（columnWidths 7 ＋ 既存）

- [ ] **Step 9: コミット**

```bash
git add package.json package-lock.json src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat(grid): 結果行を react-virtual で仮想化（スペーサ＋偶奇ストライプ＋scrollToIndex）"
```

- [ ] **Step 10: 手動 GUI 確認（最終ゲート・subagent 不可）**

`docker compose -f docker-compose.test.yml up -d` ＋ `npm run dev` で >1000 行（理想 10000 行）のテーブル／SQL結果を開き、以下を目視:
- 滑らかにスクロールでき、DevTools Elements で `<tr>` 数が一定（可視＋オーバースキャン分のみ）。
- ヘッダが本文と整合し、スクロールで幅がガタつかない。固定幅超過セルが ellipsis 省略表示。
- 行選択（クリック/Shift/⌘/⌘A）・矢印キー移動＋自動スクロール・セル編集（ダブルクリック）・右クリックメニュー・quick filter・INSERT 行・削除ステージング・複製・コピーが全て動作。
- 偶奇ストライプが正しく、スクロールしてもちらつかない。
- テーブル閲覧・CSVエクスポートが不変。

---

## Self-Review（計画 vs 設計）

**1. Spec coverage:**
- §3.1 `<table>` 構造維持＋スペーサ仮想化 → Task 3。
- §3.2 カラム幅実測固定（純関数 ＋ canvas measure ＋ colgroup ＋ table-layout fixed ＋ ellipsis）→ Task 1（純関数）＋ Task 2（適用・CSS）。
- §3.3 useVirtualizer / 固定 estimateSize / スペーサ / react-table 行モデルへ `vi.index` インデックス / INSERT 非仮想化 → Task 3。
- §3.4 ストライプ偶奇クラス化・`scrollToIndex` 置換 → Task 3 Step 6/5。
- §3.5 編集中スクロールアウト挙動・⌘A・右クリック維持 → Task 3 は行レンダリング中身を無改変で移植（維持）。
- §4 ファイル構成 → Task 1/2/3 の Files と一致。
- §5 テスト（ユニット＋typecheck/build＋手動GUI）→ Task 1 Step1-4 ＋ Task 2/3 の typecheck/build/vitest ＋ Task 3 Step 10。
- §6 限界（行高前提・サンプリング・canvas 近似・横非仮想化）→ Global Constraints の ROW_HEIGHT 一致制約と Task 2 の固定行高 CSS で担保。

**2. Placeholder scan:** TBD/TODO・抽象指示なし。全コードブロックは実コード。

**3. Type consistency:** `estimateColumnWidths`/`ROW_HEIGHT`/`MIN_COL_WIDTH`/`MAX_COL_WIDTH` のシグネチャは Task 1 定義と Task 2/3 利用で一致。`colWidths: number[]` / `totalWidth: number` / `rowVirtualizer`（`getVirtualItems`/`getTotalSize`/`scrollToIndex`）の利用は react-virtual の API と一致。`styles.rowAlt` / `styles.spacer` は Task 3 CSS で定義し同タスクで利用。
