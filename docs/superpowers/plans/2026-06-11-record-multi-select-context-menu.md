# レコード複数選択 + 右クリックバルク操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルのレコード一覧で複数行を選択し、右クリックメニューから「削除 / 複製 / クリップボードにコピー」をまとめて実行できるようにする。

**Architecture:** 選択状態は `TableTab` にストア管理（既存のリセット機構を拡張）。削除・複製は既存の DELETE/INSERT ステージング機構（⌘S でトランザクションコミット）に乗せる。複製は auto_increment 列を除外して自動採番。コピーは TSV をクリップボードへ。auto_increment 検出のため main 側にメタデータ取得を1つ追加。

**Tech Stack:** Electron + React + TypeScript + Zustand + @tanstack/react-table + mysql2 + Vitest

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/renderer/src/lib/csv.ts` | `toTsv` 純関数（タブ区切り・ヘッダなし）。 |
| `src/renderer/src/lib/csv.test.ts` | `toTsv` の単体テスト。 |
| `src/main/connection/ConnectionManager.ts` | `autoIncrementColumns(table)` 追加。 |
| `src/main/ipc/registerDbHandlers.ts` | `db:autoIncrementColumns` ハンドラ。 |
| `src/preload/index.ts` | `api.autoIncrementColumns` 公開。 |
| `src/renderer/src/env.d.ts` | preload API の型。 |
| `src/renderer/src/store/useAppStore.ts` | `TableTab` 型拡張、選択/削除/複製アクション、テーブルオープン時の auto_increment 取得。 |
| `src/renderer/src/store/useAppStore.test.ts`（無ければ新規） | `setSelectedRows` / `stageDeleteMany` / `duplicateRows` のロジックテスト。 |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 複数選択 UI・修飾キー・⌘A/Esc・バルクコンテキストメニュー。 |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 必要なら微調整（基本は既存 `.selected` 流用）。 |
| `src/renderer/src/workspace/DetailPane.tsx` | 選択行詳細ペイン。`selectedRowIndex` の consumer のため複数選択へ整合（Task 7）。 |

実装順序の方針: 純関数（TSV）→ main メタデータ → preload/型 → ストア型・アクション → グリッド UI。下層から積み上げ、各タスクで型チェック・テストを通す。

---

## Task 1: `toTsv` 純関数（TSV 直列化）

**Files:**
- Test: `src/renderer/src/lib/csv.test.ts`
- Modify: `src/renderer/src/lib/csv.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/csv.test.ts` に追記（既存の import / describe があれば `toTsv` の import を足し、新しい `describe` を追加）。ファイル先頭の import 行に `toTsv` を加える:

```ts
import { toCsv, toTsv } from './csv'
```

末尾に追加:

```ts
describe('toTsv', () => {
  it('タブ区切り・ヘッダなしで直列化する', () => {
    const out = toTsv(
      ['id', 'name'],
      [
        { id: 1, name: '天野工業' },
        { id: 2, name: '高速保全' }
      ]
    )
    expect(out).toBe('1\t天野工業\r\n2\t高速保全')
  })

  it('null/undefined は空文字にする', () => {
    expect(toTsv(['a', 'b'], [{ a: null, b: undefined }])).toBe('\t')
  })

  it('タブ/改行/引用符を含む値はクォートし内部の " を2重化する', () => {
    const out = toTsv(['v'], [{ v: 'a\tb' }, { v: 'c\nd' }, { v: 'he said "hi"' }])
    expect(out).toBe('"a\tb"\r\n"c\nd"\r\n"he said ""hi"""')
  })

  it('列が空なら空文字を返す', () => {
    expect(toTsv([], [{ a: 1 }])).toBe('')
  })

  it('行が空ならヘッダなしのため空文字を返す', () => {
    expect(toTsv(['a', 'b'], [])).toBe('')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/lib/csv.test.ts`
Expected: FAIL（`toTsv is not exported` / not a function）

- [ ] **Step 3: 最小実装を書く**

`src/renderer/src/lib/csv.ts` の末尾に追加:

```ts
// 1 セル分の TSV フィールドに変換する。タブ/CR/LF/ダブルクォートを含む場合のみ
// CSV と同じクォート規則（" で囲み内部の " を "" に2重化）を適用する。
function escapeTsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/["\t\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * 列順に従い行データを TSV 文字列に直列化する（ヘッダなし）。
 * 行区切りは CRLF。列が空・行が空のときは空文字を返す。
 * @param columns 出力する列順（ヘッダ行は出力しない）。
 * @param rows 各行の「列名 → 値」マップ。
 */
export function toTsv(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0 || rows.length === 0) return ''
  return rows.map((row) => columns.map((c) => escapeTsvCell(row[c])).join('\t')).join('\r\n')
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/lib/csv.test.ts`
Expected: PASS（既存 `toCsv` テストも含め緑）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/lib/csv.ts src/renderer/src/lib/csv.test.ts
git commit -m "feat: TSV 直列化の純関数 toTsv を追加"
```

---

## Task 2: `ConnectionManager.autoIncrementColumns`（main 側メタデータ取得）

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`（`primaryKey` の直後・55 行目付近）

> 注: main プロセスは実 DB 接続前提のため自動テストは置かず、型チェックとビルドで検証する（既存の `primaryKey` 等も同方針）。

- [ ] **Step 1: メソッドを追加**

`src/main/connection/ConnectionManager.ts` の `primaryKey` メソッド（`async primaryKey(...) { ... }` のブロック）の直後に追加:

```ts
  // auto_increment 属性を持つ列名を返す（複製時に除外して自動採番させるため）。
  // 接続中の DB スコープ。該当無しなら []。
  async autoIncrementColumns(table: string): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected')
    const quoted = '`' + table.replace(/`/g, '``') + '`'
    const [rows] = await this.pool.query(`SHOW COLUMNS FROM ${quoted}`)
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    return list
      .filter((r) => String(r.Extra ?? '').toLowerCase().includes('auto_increment'))
      .map((r) => String(r.Field))
  }
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit -p tsconfig.node.json`（無ければ `npm run typecheck`）
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/main/connection/ConnectionManager.ts
git commit -m "feat: auto_increment 列名を返す ConnectionManager.autoIncrementColumns を追加"
```

---

## Task 3: IPC ハンドラ + preload + 型公開

**Files:**
- Modify: `src/main/ipc/registerDbHandlers.ts`（`db:primaryKey` ハンドラの近く）
- Modify: `src/preload/index.ts`（`primaryKey` 公開の近く）
- Modify: `src/renderer/src/env.d.ts`（`primaryKey` 型の近く）

> 既存の `db:primaryKey` / `api.primaryKey` と同じパターンを踏襲する。まず該当箇所を読んで正確な書式に合わせること。

- [ ] **Step 1: IPC ハンドラを追加**

`src/main/ipc/registerDbHandlers.ts` の `db:primaryKey` ハンドラ（`ipcMain.handle('db:primaryKey', ...)`）の直後に、同じ `ok/error` 包み方で追加:

```ts
  ipcMain.handle('db:autoIncrementColumns', async (_e, table: string) => {
    try {
      return { ok: true, data: await manager.autoIncrementColumns(table) }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
```

> 既存ハンドラが `manager` 以外の変数名（例 `getManager()`）や別のエラー変換関数（例 `toAppError`）を使っている場合は、その箇所と完全に同じ書式に合わせること。

- [ ] **Step 2: preload に公開**

`src/preload/index.ts` の `primaryKey:` 公開行の直後に追加（既存が `unwrap`/直接 invoke いずれのパターンかを確認し合わせる）:

```ts
  autoIncrementColumns: (table: string) => ipcRenderer.invoke('db:autoIncrementColumns', table),
```

> 既存 `primaryKey` が結果を `unwrap` して返している場合は同じく `unwrap` する。`primaryKey` の実装を読んでから書くこと。

- [ ] **Step 3: renderer の型に追加**

`src/renderer/src/env.d.ts` の `primaryKey` の型宣言の直後に追加（戻り型は既存 `primaryKey` の書式に合わせる。例が `Promise<ApiResult<string[]>>` ならそれに合わせる）:

```ts
    autoIncrementColumns: (table: string) => Promise<ApiResult<string[]>>
```

> `primaryKey: (table: string) => Promise<...>` の戻り型表記をそのままコピーして列名だけ変えること。

- [ ] **Step 4: 型チェック**

Run: `npm run typecheck`（または `npx tsc --noEmit` 系。プロジェクトの typecheck スクリプトを使う）
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/main/ipc/registerDbHandlers.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: autoIncrementColumns を IPC/preload/型で公開"
```

---

## Task 4: `TableTab` 型拡張と選択リセット箇所の移行

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

このタスクは型・初期値・リセット箇所の機械的置換のみ。アクション本体は Task 5 以降。

- [ ] **Step 1: `TableTab` 型を変更**

`src/renderer/src/store/useAppStore.ts` の `interface TableTab`（54 行目付近）の
`selectedRowIndex: number | null // 現在ページ内で選択中の行インデックス。null = 未選択`
を次の3行に置き換える:

```ts
  selectedRowIndices: number[] // 選択中の行インデックス（統一インデックス空間: 結果行→INSERT行）
  selectionAnchor: number | null // Shift 範囲選択の起点。null = 未設定
  autoIncrementColumns: string[] // auto_increment 列名（複製で除外）
```

- [ ] **Step 2: `makeTableTab` 初期値を変更**

`makeTableTab`（98 行目付近）の `selectedRowIndex: null,` を次に置き換える:

```ts
    selectedRowIndices: [],
    selectionAnchor: null,
    autoIncrementColumns: [],
```

- [ ] **Step 3: すべての選択リセット箇所を置換**

`selectedRowIndex: null` が残っている箇所（型・初期値以外。ページ/フィルタ/ソート/ページサイズ変更・コミット・INSERT 破棄など複数）を、その文脈に応じて次に置き換える:

```ts
selectedRowIndices: [], selectionAnchor: null
```

確認コマンドで残りを洗い出す:

Run: `grep -n "selectedRowIndex" src/renderer/src/store/useAppStore.ts`
Expected: ヒットは型/初期値/アクションを除き 0 件になるよう全置換（次の Step で `selectRow` も処理）。

- [ ] **Step 4: `selectRow` アクションを暫定で型整合させる**

`selectRow(tabId, index) { patchTableTab(tabId, (t) => ({ ...t, selectedRowIndex: index })) },`（762 行目付近）を、このタスクでは型エラーを避けるため `selectedRowIndices` を使う形に暫定修正して**残す**:

```ts
    selectRow(tabId, index) {
      patchTableTab(tabId, (t) => ({ ...t, selectedRowIndices: [index], selectionAnchor: index }))
    },
```

> 呼び出し側（`ResultsGrid`）を `setSelectedRows` に移行するのは Task 7。移行後にこの `selectRow` ストアアクションが未使用になったら Task 7 の最後で削除する（型に残っていても無害だが、未使用なら消す）。ここでは型を通すことを優先。

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし（`selectedRowIndex` 参照が renderer 側に残っていれば次タスクまで残置されるグリッドはまだ旧名を使うため、ResultsGrid 側は Task 6 まで触らない。もしここで ResultsGrid がコンパイルエラーになる場合は、ResultsGrid の `selectedRowIndex` 参照を `selectedRowIndices`/`selectionAnchor` ベースへ移すのは Task 6 のため、このタスクでは `useAppStore.ts` 単体の型整合のみ確認し、全体ビルドは Task 6 完了後に行う）。

> 全体 `npm run typecheck` が ResultsGrid 由来で赤くなる場合、このタスクのコミットはストア単体の変更として進め、ResultsGrid は Task 6 で整合させる。

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "refactor: TableTab の選択状態を複数選択対応へ（selectedRowIndices/anchor/autoIncrementColumns）"
```

---

## Task 5: ストアアクション `setSelectedRows` / `stageDeleteMany` / `duplicateRows`

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`
- Test: `src/renderer/src/store/useAppStore.test.ts`（無ければ新規作成）

> Zustand ストアは `useAppStore.getState()` でアクションを呼べる。テストは「テーブルタブを1つ作って result をセット → アクション呼び出し → state 検証」の形。既存テストがあればその初期化ヘルパを再利用すること。無ければ下記の最小セットアップを使う。

### アクション型の追加

- [ ] **Step 1: ストアのアクション型（インターフェース）に3メソッドを追加**

`useAppStore.ts` のアクション型定義（`selectRow:` のシグネチャがある箇所）付近に追加:

```ts
  setSelectedRows: (tabId: string, indices: number[], anchor: number | null) => void
  stageDeleteMany: (
    tabId: string,
    entries: { rowKey: string; pkValues: Record<string, unknown> }[]
  ) => void
  duplicateRows: (tabId: string, rowIndices: number[]) => void
```

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/store/useAppStore.test.ts`（無ければ新規）に追加。ストアの作り方は既存に合わせる。新規の場合の雛形:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './useAppStore'
import type { TableTab } from './useAppStore'
import { rowKeyOf, pkValuesOf } from './rowKey'

// テスト用にテーブルタブを直接注入するヘルパ
function seedTableTab(partial: Partial<TableTab> = {}): string {
  const id = 'tab-test'
  const base: TableTab = {
    kind: 'table',
    id,
    tableName: 'customers',
    columns: ['id', 'name'],
    filters: [],
    appliedFilters: [],
    sort: null,
    pageSize: 100,
    page: 0,
    total: null,
    primaryKey: ['id'],
    edits: {},
    inserts: [],
    deletes: {},
    editError: null,
    selectedRowIndices: [],
    selectionAnchor: null,
    autoIncrementColumns: ['id'],
    result: {
      columns: [
        { name: 'id', type: 'longlong' },
        { name: 'name', type: 'var_string' }
      ],
      rows: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
      ],
      rowCount: 3,
      durationMs: 0
    },
    error: null,
    running: false,
    ...partial
  }
  useAppStore.setState({ tabs: [base], activeTabId: id })
  return id
}

function tab(id: string): TableTab {
  return useAppStore.getState().tabs.find((t) => t.id === id) as TableTab
}

describe('setSelectedRows', () => {
  beforeEach(() => seedTableTab())

  it('indices と anchor をそのまま設定する', () => {
    const id = 'tab-test'
    useAppStore.getState().setSelectedRows(id, [0, 2], 0)
    expect(tab(id).selectedRowIndices).toEqual([0, 2])
    expect(tab(id).selectionAnchor).toBe(0)
  })
})

describe('stageDeleteMany', () => {
  beforeEach(() => seedTableTab())

  it('未ステージなら全件を deletes に積む', () => {
    const id = 'tab-test'
    const rows = tab(id).result!.rows
    const entries = [rows[0], rows[1]].map((r) => ({
      rowKey: rowKeyOf(['id'], r),
      pkValues: pkValuesOf(['id'], r)
    }))
    useAppStore.getState().stageDeleteMany(id, entries)
    expect(Object.keys(tab(id).deletes)).toHaveLength(2)
  })

  it('全件が既にステージ済みなら全解除する', () => {
    const id = 'tab-test'
    const rows = tab(id).result!.rows
    const entries = [rows[0], rows[1]].map((r) => ({
      rowKey: rowKeyOf(['id'], r),
      pkValues: pkValuesOf(['id'], r)
    }))
    useAppStore.getState().stageDeleteMany(id, entries) // 積む
    useAppStore.getState().stageDeleteMany(id, entries) // 解除
    expect(Object.keys(tab(id).deletes)).toHaveLength(0)
  })

  it('一部未ステージなら全件を積む（解除ではなく追加側に倒す）', () => {
    const id = 'tab-test'
    const rows = tab(id).result!.rows
    const e0 = { rowKey: rowKeyOf(['id'], rows[0]), pkValues: pkValuesOf(['id'], rows[0]) }
    const e1 = { rowKey: rowKeyOf(['id'], rows[1]), pkValues: pkValuesOf(['id'], rows[1]) }
    useAppStore.getState().stageDeleteMany(id, [e0]) // 0 だけ積む
    useAppStore.getState().stageDeleteMany(id, [e0, e1]) // 0,1 → 一部未ステージなので全積み
    expect(Object.keys(tab(id).deletes)).toHaveLength(2)
  })
})

describe('duplicateRows', () => {
  beforeEach(() => seedTableTab())

  it('auto_increment 列を除外して inserts に追加する', () => {
    const id = 'tab-test'
    useAppStore.getState().duplicateRows(id, [0])
    const ins = tab(id).inserts
    expect(ins).toHaveLength(1)
    expect(ins[0].values).toEqual({ name: 'A' }) // id(auto_increment) は含めない
  })

  it('複数行を複製順に追加する', () => {
    const id = 'tab-test'
    useAppStore.getState().duplicateRows(id, [0, 2])
    expect(tab(id).inserts.map((i) => i.values.name)).toEqual(['A', 'C'])
  })

  it('null は null、それ以外は String に変換する', () => {
    const id = 'tab-test'
    useAppStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === 'table'
          ? { ...t, result: { ...t.result!, rows: [{ id: 9, name: null }] } }
          : t
      )
    }))
    useAppStore.getState().duplicateRows(id, [0])
    expect(tab(id).inserts[0].values).toEqual({ name: null })
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/useAppStore.test.ts`
Expected: FAIL（`setSelectedRows is not a function` 等）

- [ ] **Step 4: アクションを実装**

`useAppStore.ts` のアクション実装群（`selectRow(...)` 実装の近く）に追加:

```ts
    setSelectedRows(tabId, indices, anchor) {
      patchTableTab(tabId, (t) => ({ ...t, selectedRowIndices: indices, selectionAnchor: anchor }))
    },

    stageDeleteMany(tabId, entries) {
      patchTableTab(tabId, (t) => {
        if (entries.length === 0) return t
        const deletes = { ...t.deletes }
        const edits = { ...t.edits }
        const allStaged = entries.every((e) => e.rowKey in deletes)
        if (allStaged) {
          // 全件が既にステージ済み → 全解除（トグル）
          for (const e of entries) delete deletes[e.rowKey]
        } else {
          // 一部でも未ステージ → 全件を削除ステージに倒す
          for (const e of entries) {
            deletes[e.rowKey] = e.pkValues
            delete edits[e.rowKey] // DELETE 後の UPDATE は無意味なので破棄
          }
        }
        return { ...t, deletes, edits, editError: null }
      })
    },

    duplicateRows(tabId, rowIndices) {
      patchTableTab(tabId, (t) => {
        if (!t.result) return t
        const exclude = new Set(t.autoIncrementColumns)
        const colNames = t.result.columns.map((c) => c.name)
        const newInserts: PendingInsert[] = []
        for (const idx of rowIndices) {
          const row = t.result.rows[idx]
          if (!row) continue
          const values: Record<string, string | null> = {}
          for (const c of colNames) {
            if (exclude.has(c)) continue
            const v = row[c]
            values[c] = v === null || v === undefined ? null : String(v)
          }
          newInserts.push({ localId: `ins-${crypto.randomUUID()}`, values })
        }
        return { ...t, inserts: [...t.inserts, ...newInserts], editError: null }
      })
    },
```

> `PendingInsert` が未 import なら、ファイル先頭の型 import に追加すること（`import type { ..., PendingInsert } from '../../../shared/types'`）。

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/useAppStore.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts src/renderer/src/store/useAppStore.test.ts
git commit -m "feat: 複数選択/バルク削除/複製のストアアクションを追加"
```

---

## Task 6: テーブルオープン時に auto_increment 列を取得

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`（`primaryKey` を取得して TableTab に保存している箇所）

- [ ] **Step 1: 取得箇所を特定**

Run: `grep -n "primaryKey\b\|window.api.primaryKey" src/renderer/src/store/useAppStore.ts`
Expected: テーブルを開く処理で `window.api.primaryKey(tableName)` を呼んで `primaryKey` を tab に設定している箇所が見つかる。

- [ ] **Step 2: auto_increment 取得を並行で追加**

`primaryKey` を取得している箇所で、同じ流れで `autoIncrementColumns` も取得して tab に保存する。例（既存が `const pk = await window.api.primaryKey(name)` の形なら）:

```ts
const [pkRes, aiRes] = await Promise.all([
  window.api.primaryKey(tableName),
  window.api.autoIncrementColumns(tableName)
])
// 既存の pk 取り出し（unwrap か ok 判定か）に合わせる。失敗時は空配列でフォールバック。
const autoInc = aiRes.ok ? aiRes.data : []
```

そして tab を更新する `patchTableTab` / `set` に `autoIncrementColumns: autoInc` を含める。

> 既存の `primaryKey` の戻り値の扱い（`ApiResult` を `ok` 判定して `data` を取るのか、preload 側で `unwrap` 済みで配列が直接返るのか）を必ず確認し、`autoIncrementColumns` も同じ扱いにすること。auto_increment 取得が失敗しても複製機能が無効になるだけなので、エラーで全体を止めず `[]` フォールバックする。

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: テーブルオープン時に auto_increment 列を取得して保持"
```

---

## Task 7: グリッド UI — 複数選択（修飾キー・⌘A・Esc）

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`
- Modify: `src/renderer/src/workspace/ResultsGrid.module.css`（必要時）
- Modify: `src/renderer/src/workspace/DetailPane.tsx`（`selectedRowIndex` consumer の整合）

> このタスクで renderer 側の `selectedRowIndex` 依存（`ResultsGrid.tsx` と `DetailPane.tsx`）を解消し、`npm run typecheck` をグリーンに戻す。手動操作で検証（main 接続が要るためグリッドの自動テストは置かない）。

> **DetailPane の整合（Task 4 で判明した consumer）**: `DetailPane.tsx` 19 行目 `const index = tab.selectedRowIndex` を次に置き換える:
> ```ts
> const index = tab.selectedRowIndices.length === 1 ? tab.selectedRowIndices[0] : null
> ```
> 詳細ペインは1行の詳細編集用なので、選択がちょうど1件のときのみ表示し、0件/複数件は既存のプレースホルダ「行を選択してください」を表示する（`index = null` で既存ロジックがそのまま機能）。他の変更は不要。

- [ ] **Step 1: ストア参照を複数選択へ差し替え**

`ResultsGrid.tsx` 上部の `ResultsGrid()` 関数内:
- `const selectRow = useAppStore((s) => s.selectRow)` を `const setSelectedRows = useAppStore((s) => s.setSelectedRows)` に変更（`selectRow` 参照を削除）。
- 追加: `const stageDeleteMany = useAppStore((s) => s.stageDeleteMany)` と `const duplicateRows = useAppStore((s) => s.duplicateRows)`。
- `const selectedRowIndex = isTable ? tab.selectedRowIndex : null` を
  ```ts
  const selectedRowIndices = isTable ? tab.selectedRowIndices : []
  const selectionAnchor = isTable ? tab.selectionAnchor : null
  const autoIncrementColumns = isTable ? tab.autoIncrementColumns : []
  ```
  に変更。
- `const onSelectRow = isTable ? (index) => selectRow(tab.id, index) : undefined` を削除し、代わりに選択更新コールバックを定義:
  ```ts
  const onSetSelection = isTable
    ? (indices: number[], anchor: number | null): void => setSelectedRows(tab.id, indices, anchor)
    : undefined
  const onStageDeleteMany = isTable
    ? (entries: { rowKey: string; pkValues: Record<string, unknown> }[]): void =>
        stageDeleteMany(tab.id, entries)
    : undefined
  const onDuplicateRows = isTable
    ? (indices: number[]): void => duplicateRows(tab.id, indices)
    : undefined
  ```

- [ ] **Step 2: `Grid` の props を差し替え**

`<Grid ... />` の呼び出しと `Grid` の引数・型定義を更新:
- `selectedRowIndex` / `onSelectRow` を削除。
- 追加で渡す: `selectedRowIndices={selectedRowIndices}`, `selectionAnchor={selectionAnchor}`, `autoIncrementColumns={autoIncrementColumns}`, `rowCount={tab.result?.rows.length ?? 0}`, `onSetSelection={onSetSelection}`, `onStageDeleteMany={onStageDeleteMany}`, `onDuplicateRows={onDuplicateRows}`。
- `Grid` の引数 destructure と型 (`{ ... }: { ... }`) も同様に置換:
  ```ts
  selectedRowIndices: number[]
  selectionAnchor: number | null
  autoIncrementColumns: string[]
  onSetSelection?: (indices: number[], anchor: number | null) => void
  onStageDeleteMany?: (entries: { rowKey: string; pkValues: Record<string, unknown> }[]) => void
  onDuplicateRows?: (indices: number[]) => void
  ```

- [ ] **Step 3: 選択計算ヘルパを `Grid` 内に追加**

`Grid` 関数本体の上部（`ctxMenu` state の近く）に、結果行数 `rowCount` を使う選択ロジックを追加:

```ts
  const selectedSet = useMemo(() => new Set(selectedRowIndices), [selectedRowIndices])

  // クリック + 修飾キーから次の選択集合を計算して通知する。
  const handleRowMouseDown = (index: number, e: React.MouseEvent): void => {
    if (!onSetSelection) return
    if (e.shiftKey) {
      const anchor = selectionAnchor ?? index
      const lo = Math.min(anchor, index)
      const hi = Math.max(anchor, index)
      const range: number[] = []
      for (let i = lo; i <= hi; i++) range.push(i)
      onSetSelection(range, anchor)
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedSet)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      onSetSelection([...next], index)
    } else {
      onSetSelection([index], index)
    }
  }
```

- [ ] **Step 4: 行のハイライト・クリックを集合ベースに変更**

結果行の `<tr>`（198 行目付近）:
- `className` の `r.index === selectedRowIndex` を `selectedSet.has(r.index)` に変更。
- `onClick={onSelectRow ? () => onSelectRow(r.index) : undefined}` を
  `onMouseDown={(e) => handleRowMouseDown(r.index, e)}` に変更（Shift+クリックのテキスト選択を防ぐため、必要なら行 `<tr>` の `onMouseDown` で `if (e.shiftKey) e.preventDefault()`）。

INSERT 行（308 行目付近）の `onClick`/`onContextMenu` の `onSelectRow?.(...)` は、单一選択として
`onSetSelection?.([result.rows.length + insertIndex], result.rows.length + insertIndex)` に置き換える（INSERT 行はバルク対象外だが、ハイライトと右クリック時の単一選択は維持）。

- [ ] **Step 5: ⌘A / Esc のキーボード操作**

`gridWrap` の外側 `<div className={styles.gridWrap}>` に `tabIndex={0}` と `onKeyDown` を付与:

```tsx
    <div
      className={styles.gridWrap}
      tabIndex={0}
      onKeyDown={(e) => {
        if (!onSetSelection) return
        if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault()
          const all: number[] = []
          for (let i = 0; i < rowCount; i++) all.push(i)
          onSetSelection(all, 0)
        } else if (e.key === 'Escape') {
          onSetSelection([], null)
        }
      }}
    >
```

> `rowCount` は Step 2 で props として受け取った結果行数。`onKeyDown` 内で `editing`（セル編集中）の場合は早期 return して入力中の ⌘A/Esc を奪わないようにする: 関数先頭に `if (editing) return`。

- [ ] **Step 6: cell コンテキストメニューの選択挙動を修正**

セルの `onContextMenu`（254 行目付近）で現在 `onSelectRow?.(r.index)` を呼んでいる部分を、次のロジックに変更:

```ts
// 右クリック行が選択に含まれていなければ単一選択に畳む。含まれていれば選択維持。
if (!selectedSet.has(r.index)) onSetSelection?.([r.index], r.index)
```

- [ ] **Step 7: 型チェック・ビルド**

Run: `npm run typecheck`
Expected: エラーなし（`selectedRowIndex` 参照が ResultsGrid から消えていること）

- [ ] **Step 8: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx src/renderer/src/workspace/ResultsGrid.module.css
git commit -m "feat: レコードグリッドの複数選択（修飾キー/⌘A/Esc）"
```

---

## Task 8: グリッド UI — バルクコンテキストメニュー（削除/複製/コピー）

**Files:**
- Modify: `src/renderer/src/workspace/ResultsGrid.tsx`

- [ ] **Step 1: TSV コピーの import を追加**

`ResultsGrid.tsx` の import に追加:

```ts
import { toTsv } from '../lib/csv'
```

- [ ] **Step 2: バルクコピー関数を `Grid` 内に追加**

`Grid` 本体に、選択結果行から TSV を作りクリップボードへ書く関数を追加:

```ts
  const copySelectedRows = (indices: number[]): void => {
    const colNames = result.columns.map((c) => c.name)
    const rows = indices
      .filter((i) => i < result.rows.length)
      .sort((a, b) => a - b)
      .map((i) => result.rows[i] as Row)
    if (rows.length === 0) return
    void navigator.clipboard.writeText(toTsv(colNames, rows))
  }
```

- [ ] **Step 3: cell メニューにバルク項目を追加**

`ctxMenu.kind === 'cell'` ブロック内の既存「行を削除」セクション（440-465 行目付近、`onStageDelete && (...)`）を、バルク項目に置き換える。`selectedSet` から結果行のみの選択を求め、件数 `n` と「全件削除済みか」を計算して表示を切り替える:

```tsx
{onStageDeleteMany && (() => {
  const selResult = [...selectedSet].filter((i) => i < result.rows.length).sort((a, b) => a - b)
  // 右クリック行が選択外なら Step 6(Task7) で単一選択に畳んでいるので、ここでは selectedSet を信頼。
  const targets = selResult.length > 0 ? selResult : []
  if (targets.length === 0) return null
  const entries = targets.map((i) => {
    const row = result.rows[i] as Row
    return { rowKey: rowKeyOf(primaryKey, row), pkValues: pkValuesOf(primaryKey, row) }
  })
  const allStaged = entries.every((e) => e.rowKey in deletes)
  const n = targets.length
  return (
    <>
      <div className={styles.ctxSep} />
      <div
        className={`${styles.ctxItem} ${allStaged ? '' : styles.ctxDanger}`}
        onClick={() => {
          onStageDeleteMany(entries)
          setCtxMenu(null)
        }}
      >
        {allStaged ? `削除を取り消す（${n} 行）` : `選択 ${n} 行を削除`}
      </div>
      <div
        className={styles.ctxItem}
        onClick={() => {
          onDuplicateRows?.(targets)
          setCtxMenu(null)
        }}
      >
        選択 {n} 行を複製
      </div>
      <div
        className={styles.ctxItem}
        onClick={() => {
          copySelectedRows(targets)
          setCtxMenu(null)
        }}
      >
        選択 {n} 行をコピー
      </div>
    </>
  )
})()}
```

> 既存の単一「行を削除 / 削除を取り消す」UI（`onStageDelete` 依存）はこのブロックで置き換えるため削除する。`onStageDelete` prop と `stageDelete` の渡し（ResultsGrid 上部・Grid props）も未使用になるなら削除して良い。ただし他からの参照が無いことを `grep -n "onStageDelete\b\|stageDelete\b" src/renderer/src/workspace/ResultsGrid.tsx` で確認してから消すこと。

- [ ] **Step 4: 編集不可テーブルでの非表示を確認**

`editable === false`（主キーなし）のときは `onStageDeleteMany` / `onDuplicateRows` が `undefined` になる（Task 7 で `isTable && editable` 条件で生成）ので、バルク削除/複製は出ない。コピーは読み取り専用でも可能にするため、コピー項目だけは `onStageDeleteMany` 無しでも表示するか検討 → 今回は**主キーなしテーブルではバルクメニュー全体を非表示**にする（YAGNI、削除/複製と挙動を揃える）。`copySelectedRows` は将来単独で出せるが今回はスコープ外。

> 実装メモ: 上記 Step 3 のブロックは `onStageDeleteMany &&` でガードしているため、主キーなし（`editable=false`）では丸ごと非表示。これで意図通り。

- [ ] **Step 5: 型チェック・ビルド**

Run: `npm run typecheck && npm run build`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/workspace/ResultsGrid.tsx
git commit -m "feat: レコードグリッドの右クリックにバルク削除/複製/コピーを追加"
```

---

## Task 9: 全体検証と手動確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト・型・ビルド**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: すべて緑

- [ ] **Step 2: 手動確認（`npm run dev`）**

以下を実機確認:
1. 行をクリック → 単一選択ハイライト。
2. Shift+クリック → アンカーからの範囲選択。
3. ⌘/Ctrl+クリック → 個別トグル（追加・解除）。
4. グリッドにフォーカスして ⌘A → 全結果行選択。Esc → 解除。
5. 複数選択 → 右クリック → 「選択 N 行を削除」→ 対象行が赤マーク。⌘S → DB から削除され再クエリ。
6. 複数選択 → 右クリック → 「選択 N 行を複製」→ 緑の新規行が N 行追加（id 列は `—`）。⌘S → 新 id で採番されて挿入。
7. 複数選択 → 右クリック → 「選択 N 行をコピー」→ 表計算ソフトに貼り付けてタブ区切りで列が分かれることを確認。
8. 既に削除ステージ済みの行だけを選択して右クリック → 「削除を取り消す（N 行）」で解除できる。
9. ページ送り/フィルタ適用/ソートで選択がリセットされる。
10. 主キーなしのテーブル（またはビュー）ではバルクメニューが出ない。

- [ ] **Step 3: 最終コミット（必要なら微修正）**

手動確認で見つかった微修正があれば対応し、

```bash
git add -A
git commit -m "fix: 複数選択バルク操作の手動確認で見つかった調整"
```

---

## Self-Review（計画作成者によるチェック結果）

- **スペック網羅**: 複数選択（Task 7）/ バルクメニュー（Task 8）/ 削除＝stageDeleteMany（Task 5,8）/ 複製＝duplicateRows＋auto_increment 除外（Task 2,5,6,8）/ コピー＝toTsv（Task 1,8）/ メタデータ取得（Task 2,3,6）/ 選択状態リセット（Task 4）/ 主キーなし非表示（Task 8）— すべてタスクに対応。
- **プレースホルダ**: なし（各ステップに具体コード・コマンド・期待結果を記載）。既存コード書式に「合わせる」指示は、対象が既存パターン依存（IPC/preload/primaryKey 取得）の箇所に限定し、コピー元を明示。
- **型整合**: `setSelectedRows(tabId, indices, anchor)` / `stageDeleteMany(tabId, entries:{rowKey,pkValues}[])` / `duplicateRows(tabId, rowIndices)` をストア型・実装・呼び出し（ResultsGrid）・テストで統一。`PendingInsert.values: Record<string,string|null>` と複製の値変換（null→null/その他→String）が整合。`autoIncrementColumns` は型・初期値・取得・複製除外で一貫。

## スコープ外（YAGNI）

- INSERT 行へのバルク操作（破棄は従来どおり単一メニュー）。
- 列選択 / 矩形選択 / ドラッグ範囲選択。
- コピーのヘッダ付与・CSV 切替（TSV ヘッダなし固定）。
- 主キーなしテーブルでのコピー単独提供。
