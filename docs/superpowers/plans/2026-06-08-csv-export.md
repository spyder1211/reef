# レコード一覧の CSV エクスポート Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テーブルタブのレコード一覧（現在ページ／フィルタ全件）を CSV としてファイル保存・クリップボードコピーできるようにする。

**Architecture:** 純粋関数 `toCsv` で CSV 直列化（テスト対象）、メインプロセスの `file:saveCsv` IPC でネイティブ保存ダイアログ＋BOM 付き書き込み、`filterBuilder` を `limit: null` で全件取得に対応、ストアの `exportCsv` アクションで範囲×受け渡しを束ね、`ExportMenu` コンポーネントを `FilterBar` フッターに配置する。

**Tech Stack:** Electron / React 18 / TypeScript / Zustand / Vitest / CSS Modules

設計: `docs/superpowers/specs/2026-06-08-csv-export-design.md`

---

## ファイル構成

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/renderer/src/lib/csv.ts` | 新規 | `toCsv` 純粋関数（CSV 直列化・BOM なし） |
| `src/renderer/src/lib/csv.test.ts` | 新規 | `toCsv` の単体テスト |
| `src/renderer/src/store/filterBuilder.ts` | 変更 | `limit: null` で `LIMIT` を省略（全件取得） |
| `src/renderer/src/store/filterBuilder.test.ts` | 変更 | `limit: null` のテスト追加 |
| `src/shared/types.ts` | 変更 | `SaveFileResult` 型追加 |
| `src/main/ipc/registerFileHandlers.ts` | 新規 | `file:saveCsv` IPC（dialog + fs、BOM 付与） |
| `src/main/index.ts` | 変更 | `registerFileHandlers()` 呼び出し |
| `src/preload/index.ts` | 変更 | `api.saveCsv` 追加 |
| `src/renderer/src/env.d.ts` | 変更 | `window.api.saveCsv` の型宣言追加 |
| `src/renderer/src/store/useAppStore.ts` | 変更 | `exportCsv` アクション＋`ExportCsvResult` 型 |
| `src/renderer/src/workspace/ExportMenu.tsx` | 新規 | エクスポートボタン＋ドロップダウン |
| `src/renderer/src/workspace/ExportMenu.module.css` | 新規 | 上記のスタイル |
| `src/renderer/src/workspace/FilterBar.tsx` | 変更 | フッターに `ExportMenu` を配置 |

---

## Task 1: `toCsv` 純粋関数（CSV 直列化）

**Files:**
- Create: `src/renderer/src/lib/csv.ts`
- Test: `src/renderer/src/lib/csv.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/renderer/src/lib/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('ヘッダ + 複数行を CRLF で連結する', () => {
    const csv = toCsv(
      ['id', 'name'],
      [
        { id: 1, name: 'x' },
        { id: 2, name: 'y' }
      ]
    )
    expect(csv).toBe('id,name\r\n1,x\r\n2,y')
  })

  it('null / undefined は空文字（空セル）', () => {
    expect(toCsv(['a', 'b'], [{ a: null, b: undefined }])).toBe('a,b\r\n,')
  })

  it('カンマを含む値はダブルクォートで囲む', () => {
    expect(toCsv(['a'], [{ a: 'x,y' }])).toBe('a\r\n"x,y"')
  })

  it('ダブルクォートを含む値は "" に2重化して囲む', () => {
    expect(toCsv(['a'], [{ a: 'he said "hi"' }])).toBe('a\r\n"he said ""hi"""')
  })

  it('改行を含む値はダブルクォートで囲む', () => {
    expect(toCsv(['a'], [{ a: 'line1\nline2' }])).toBe('a\r\n"line1\nline2"')
  })

  it('数値・真偽値は String() で文字列化', () => {
    expect(toCsv(['n', 'b'], [{ n: 42, b: true }])).toBe('n,b\r\n42,true')
  })

  it('行が空のときはヘッダ行のみ', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b')
  })

  it('列が空のときは空文字を返す', () => {
    expect(toCsv([], [])).toBe('')
  })

  it('BOM を含まない', () => {
    expect(toCsv(['a'], [{ a: '1' }]).charCodeAt(0)).not.toBe(0xfeff)
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/renderer/src/lib/csv.test.ts`
Expected: FAIL（`toCsv` が存在しない／インポート解決不可）

- [ ] **Step 3: 実装を書く**

Create `src/renderer/src/lib/csv.ts`:

```ts
// CSV 直列化（純粋関数）。BOM は付けない（ファイル保存時にメイン側で付与する）。
// 値は null/undefined を空文字、それ以外は String(value)（グリッド表示と一致）にし、
// RFC 4180 のクォート規則でエスケープする。行区切りは CRLF。

// 値を 1 セル分の CSV フィールドに変換する。
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // ダブルクォート・カンマ・CR・LF のいずれかを含む場合はクォートし、内部の " を "" に2重化する。
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * 列名（ヘッダ）と行データから CSV 文字列を生成する。
 * @param columns ヘッダに使う列名（出力する列順を兼ねる）。
 * @param rows 各行の「列名 → 値」マップ。
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  if (columns.length === 0) return ''
  const header = columns.map(escapeCell).join(',')
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c])).join(','))
  return [header, ...body].join('\r\n')
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/renderer/src/lib/csv.test.ts`
Expected: PASS（9 件すべて）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/lib/csv.ts src/renderer/src/lib/csv.test.ts
git commit -m "feat: CSV 直列化の純粋関数 toCsv を追加"
```

---

## Task 2: `filterBuilder` を全件取得（`limit: null`）に対応

**Files:**
- Modify: `src/renderer/src/store/filterBuilder.ts`（`PageOptions` と `buildFilteredQuery`）
- Test: `src/renderer/src/store/filterBuilder.test.ts`（テスト追加）

- [ ] **Step 1: 失敗するテストを追加**

`src/renderer/src/store/filterBuilder.test.ts` の `describe('buildFilteredQuery options (sort/limit/offset)', ...)` ブロックの末尾（`it('limit/offset が整数でなければ既定値にフォールバック', ...)` の後）に追加:

```ts
  it('limit: null は LIMIT を付けない（全件）', () => {
    const r = buildFilteredQuery('t', cols, [], { limit: null })
    expect(r.sql).toBe('SELECT * FROM `t`')
  })

  it('limit: null でも WHERE / ORDER BY は付く（OFFSET は付かない）', () => {
    const r = buildFilteredQuery(
      't',
      cols,
      [{ id: 'x', enabled: true, value: '5', value2: '', column: 'id', operator: '=' }],
      { sort: { column: 'name', dir: 'asc' }, limit: null, offset: 100 }
    )
    expect(r.sql).toBe('SELECT * FROM `t` WHERE `id` = ? ORDER BY `name` ASC')
    expect(r.params).toEqual(['5'])
  })
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/renderer/src/store/filterBuilder.test.ts`
Expected: FAIL（現状 `limit: null` でも `LIMIT 100` が付く。なお `limit?: number` 型のため `limit: null` で型エラーになる場合もある）

- [ ] **Step 3: 実装を変更**

`src/renderer/src/store/filterBuilder.ts` の `PageOptions` を変更:

```ts
export interface PageOptions {
  sort?: TableSort | null
  limit?: number | null // null = LIMIT なし（全件）
  offset?: number
}
```

同ファイルの `buildFilteredQuery` 内、`const orderBy = ...` 以降の SQL 組み立て部を次に置き換える:

```ts
  const orderBy = orderByClause(columns, options?.sort)
  const unlimited = options?.limit === null
  const limit = safeInt(options?.limit, 100)
  const offset = safeInt(options?.offset, 0)
  const sql =
    `SELECT * FROM ${quoteIdent(table)}` +
    (where ? ` WHERE ${where}` : '') +
    (orderBy ? ` ORDER BY ${orderBy}` : '') +
    (unlimited ? '' : ` LIMIT ${limit}`) +
    (!unlimited && offset > 0 ? ` OFFSET ${offset}` : '')
  return { sql, params }
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/renderer/src/store/filterBuilder.test.ts`
Expected: PASS（既存テスト＋追加 2 件）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/store/filterBuilder.ts src/renderer/src/store/filterBuilder.test.ts
git commit -m "feat: buildFilteredQuery を limit:null で全件取得に対応"
```

---

## Task 3: ファイル保存 IPC（メインプロセス）

**Files:**
- Modify: `src/shared/types.ts`（`SaveFileResult` 追加）
- Create: `src/main/ipc/registerFileHandlers.ts`
- Modify: `src/main/index.ts:30-34`（`registerFileHandlers()` 呼び出し）
- Modify: `src/preload/index.ts`（`saveCsv` 追加）
- Modify: `src/renderer/src/env.d.ts`（`window.api.saveCsv` 型）

> このタスクは dialog/fs/IPC への依存のため単体テストを持たない（既存方針＝純粋関数にテストを集約）。検証は Step 5 の typecheck で行う。

- [ ] **Step 1: 共有型を追加**

`src/shared/types.ts` の末尾に追加:

```ts
// ファイル保存ダイアログの結果
export interface SaveFileResult {
  canceled: boolean
  filePath?: string
}
```

- [ ] **Step 2: IPC ハンドラを作成**

Create `src/main/ipc/registerFileHandlers.ts`:

```ts
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import type { ApiResult, SaveFileResult } from '../../shared/types'

export function registerFileHandlers(): void {
  ipcMain.handle(
    'file:saveCsv',
    async (_e, defaultFileName: string, content: string): Promise<ApiResult<SaveFileResult>> => {
      try {
        const opts = {
          defaultPath: defaultFileName,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        }
        const win = BrowserWindow.getFocusedWindow()
        const result = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts)
        if (result.canceled || !result.filePath) {
          return { ok: true, data: { canceled: true } }
        }
        // BOM を付与して UTF-8 で書き込む（Excel で日本語が文字化けしないように）
        await writeFile(result.filePath, '\uFEFF' + content, 'utf-8')
        return { ok: true, data: { canceled: false, filePath: result.filePath } }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: { code: 'FILE_ERROR', message } }
      }
    }
  )
}
```

- [ ] **Step 3: メインで登録する**

`src/main/index.ts` の import 群に追加:

```ts
import { registerFileHandlers } from './ipc/registerFileHandlers'
```

`app.whenReady().then(() => { ... })` 内、`registerConnectionHandlers(...)` の直後に追加:

```ts
  registerFileHandlers()
```

- [ ] **Step 4: preload と型宣言を追加**

`src/preload/index.ts` の型 import に `SaveFileResult` を追加:

```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult
} from '../shared/types'
```

`const api = { ... }` の `applyChanges` の行の直後（`connections:` の前）に追加:

```ts
  saveCsv: (defaultFileName: string, content: string): Promise<ApiResult<SaveFileResult>> =>
    ipcRenderer.invoke('file:saveCsv', defaultFileName, content),
```

`src/renderer/src/env.d.ts` の型 import に `SaveFileResult` を追加:

```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult
} from '../../shared/types'
```

`interface Window { api: { ... } }` の `applyChanges` の行の直後に追加:

```ts
      saveCsv: (defaultFileName: string, content: string) => Promise<ApiResult<SaveFileResult>>
```

- [ ] **Step 5: 型チェックで検証**

Run: `npm run typecheck`
Expected: エラーなしで完了（main/web 両方）

- [ ] **Step 6: コミット**

```bash
git add src/shared/types.ts src/main/ipc/registerFileHandlers.ts src/main/index.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: CSV 保存用 file:saveCsv IPC を追加（BOM 付き UTF-8）"
```

---

## Task 4: ストアの `exportCsv` アクション

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

> ストアアクションは `window.api` / `navigator.clipboard` / `window.confirm` への依存のため単体テストを持たない（既存方針）。検証は Step 3 の typecheck と Task 6 の手動確認で行う。

- [ ] **Step 1: 型とインターフェースを追加**

`src/renderer/src/store/useAppStore.ts` の先頭付近、`import` 群に `toCsv` を追加:

```ts
import { toCsv } from '../lib/csv'
```

（`buildFilteredQuery` は既に `'./filterBuilder'` からインポート済みのため追加不要）

`export type Status = ...` の行の直後に、エクスポート結果の型を追加:

```ts
// exportCsv の結果（UI のフィードバック用）。message は成功時の表示文言（空なら表示しない）。
export type ExportCsvResult =
  | { ok: true; canceled?: boolean; message: string }
  | { ok: false; message: string }
```

`interface AppState { ... }` 内、`toggleDetail: () => void` の直前に追加:

```ts
  exportCsv: (
    tabId: string,
    opts: { scope: 'page' | 'all'; target: 'file' | 'clipboard' }
  ) => Promise<ExportCsvResult>
```

- [ ] **Step 2: アクションを実装**

`return { ... }` で返すオブジェクト内、`selectRow(...) { ... }` の直後（`toggleDetail` の前）に追加:

```ts
    async exportCsv(tabId, opts) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !tab.result) {
        return { ok: false, message: 'エクスポートできる結果がありません。' }
      }

      // 全件は重くなり得るため、件数が分かっていればフェッチ前に確認する。
      const EXPORT_CONFIRM_THRESHOLD = 50000
      if (
        opts.scope === 'all' &&
        tab.total !== null &&
        tab.total > EXPORT_CONFIRM_THRESHOLD
      ) {
        if (!window.confirm(`${tab.total} 件をエクスポートします。よろしいですか？`)) {
          return { ok: true, canceled: true, message: '' }
        }
      }

      // 列と行を決定する。
      let columns: string[]
      let rows: Record<string, unknown>[]
      if (opts.scope === 'page') {
        // 既読み込みの現在ページ・現在のソートをそのまま使う（追加クエリなし）。
        columns = tab.result.columns.map((c) => c.name)
        rows = tab.result.rows
      } else {
        // 全件: LIMIT を外して再取得する。tab.running は立てず、グリッド表示を維持する。
        const { sql, params } = buildFilteredQuery(tab.tableName, tab.columns, tab.filters, {
          sort: tab.sort,
          limit: null
        })
        try {
          const res = await window.api.query(sql, params)
          if (!res.ok) return { ok: false, message: res.error.message }
          columns = res.data.columns.map((c) => c.name)
          rows = res.data.rows
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
      }

      const csv = toCsv(columns, rows)

      if (opts.target === 'clipboard') {
        try {
          await navigator.clipboard.writeText(csv)
          return { ok: true, message: 'クリップボードにコピーしました' }
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
      }

      // target: 'file'
      try {
        const res = await window.api.saveCsv(`${tab.tableName}.csv`, csv)
        if (!res.ok) return { ok: false, message: res.error.message }
        if (res.data.canceled) return { ok: true, canceled: true, message: '' }
        const name = res.data.filePath?.split('/').pop() ?? res.data.filePath ?? ''
        return { ok: true, message: `保存しました: ${name}` }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
```

- [ ] **Step 3: 型チェックで検証**

Run: `npm run typecheck`
Expected: エラーなしで完了

- [ ] **Step 4: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: CSV エクスポートのストアアクション exportCsv を追加"
```

---

## Task 5: `ExportMenu` コンポーネントと `FilterBar` 配線

**Files:**
- Create: `src/renderer/src/workspace/ExportMenu.tsx`
- Create: `src/renderer/src/workspace/ExportMenu.module.css`
- Modify: `src/renderer/src/workspace/FilterBar.tsx`

> DOM 依存のため単体テストは持たない。検証は typecheck と Task 6 の手動確認で行う。

- [ ] **Step 1: コンポーネントを作成**

Create `src/renderer/src/workspace/ExportMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import styles from './ExportMenu.module.css'

type Scope = 'page' | 'all'
type Target = 'file' | 'clipboard'

// テーブルタブのレコードを CSV としてエクスポートするメニュー。
// 範囲（現在ページ/全件）× 受け渡し（保存/コピー）の 4 通りをドロップダウンで提供する。
export default function ExportMenu({ disabled }: { disabled: boolean }): JSX.Element {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const exportCsv = useAppStore((s) => s.exportCsv)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 外側クリックで閉じる（ResultsGrid の ctxMenu と同じ mousedown 方式）。
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // 一時メッセージのタイマをアンマウント時に片付ける。
  useEffect(() => {
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current)
    }
  }, [])

  const showMessage = (text: string): void => {
    setMsg(text)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(''), 3000)
  }

  const run = async (scope: Scope, target: Target): Promise<void> => {
    if (!activeTabId) return
    setOpen(false)
    setBusy(true)
    try {
      const res = await exportCsv(activeTabId, { scope, target })
      if (!res.ok) {
        window.alert(`エクスポートに失敗しました: ${res.message}`)
      } else if (res.message) {
        showMessage(res.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // wrap 内の mousedown を止め、ボタン/項目クリックで即座に閉じないようにする。
  return (
    <div className={styles.wrap} onMouseDown={(e) => e.stopPropagation()}>
      {msg && <span className={styles.msg}>{msg}</span>}
      <button className={styles.btn} disabled={disabled || busy} onClick={() => setOpen((v) => !v)}>
        エクスポート ▾
      </button>
      {open && (
        <div className={styles.menu}>
          <div className={styles.item} onClick={() => void run('page', 'file')}>
            現在のページを CSV 保存
          </div>
          <div className={styles.item} onClick={() => void run('page', 'clipboard')}>
            現在のページをコピー
          </div>
          <div className={styles.sep} />
          <div className={styles.item} onClick={() => void run('all', 'file')}>
            全件を CSV 保存
          </div>
          <div className={styles.item} onClick={() => void run('all', 'clipboard')}>
            全件をコピー
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: スタイルを作成**

Create `src/renderer/src/workspace/ExportMenu.module.css`:

```css
.wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
}
.btn:hover {
  background: #e9e9ee;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn:disabled:hover {
  background: var(--bg);
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 4px 0;
  z-index: 1000;
  min-width: 180px;
  font-size: 12px;
}
.item {
  padding: 6px 14px;
  cursor: pointer;
  white-space: nowrap;
}
.item:hover {
  background: #2f7bf6;
  color: #fff;
}
.sep {
  height: 1px;
  background: #eee;
  margin: 4px 0;
}
.msg {
  font-size: 11px;
  color: var(--text-muted);
}
```

- [ ] **Step 3: `FilterBar` に配置**

`src/renderer/src/workspace/FilterBar.tsx` の import 群（`import styles from './FilterBar.module.css'` の直前）に追加:

```tsx
import ExportMenu from './ExportMenu'
```

同ファイルのフッター内、`<div className={styles.spacer} />` の直後（`Clear` ボタンの直前）に追加:

```tsx
        <ExportMenu disabled={!tab.result || tab.running} />
```

- [ ] **Step 4: 型チェックで検証**

Run: `npm run typecheck`
Expected: エラーなしで完了

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/ExportMenu.tsx src/renderer/src/workspace/ExportMenu.module.css src/renderer/src/workspace/FilterBar.tsx
git commit -m "feat: CSV エクスポートメニューを FilterBar に追加"
```

---

## Task 6: 全体検証（型・テスト・手動確認）

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで完了

- [ ] **Step 2: 全テスト**

Run: `npm test`
Expected: 全テスト PASS（`csv.test.ts` 9 件、`filterBuilder.test.ts` の追加 2 件を含む）

- [ ] **Step 3: 手動確認（開発ビルド）**

Run: `npm run dev`

確認項目（MySQL 接続 → 左ペインからテーブルを開く → フィルターバー右の「エクスポート ▾」）:
- 「現在のページを CSV 保存」→ 保存ダイアログが開き、`<テーブル名>.csv` が既定名。保存後、ファイルを Excel で開いて日本語が文字化けしないこと（BOM 確認）。
- 「現在のページをコピー」→ 「クリップボードにコピーしました」が一時表示され、テキストエディタに貼り付けて CSV になっていること。
- 「全件を CSV 保存」→ フィルタ適用中はその条件の全件（現在ページに限らない）が出力されること。
- 「全件をコピー」→ 同上がクリップボードに入ること。
- NULL セルが空欄で出力されること。カンマ/改行/ダブルクォートを含む値が壊れずに開けること。
- 保存ダイアログをキャンセルしてもエラーにならず、メニューが通常状態に戻ること。

- [ ] **Step 4: 完了**

手動確認まで問題なければ実装完了。`superpowers:finishing-a-development-branch` で統合方法（マージ/PR）を選ぶ。

---

## Self-Review メモ

- **Spec 網羅:** scope（page/all）= Task 4、target（file/clipboard）= Task 3+4、UTF-8 BOM+CRLF = Task 1（CRLF）+Task 3（BOM）、NULL→空セル = Task 1、4 通りメニュー = Task 5、大量件数確認 = Task 4、`limit: null` 全件 = Task 2、テスト集約方針 = 各タスク注記。SQL タブ対象外（非スコープ）。すべて対応済み。
- **型整合:** `SaveFileResult`（types→preload→env.d.ts→useAppStore で一貫）、`ExportCsvResult`（useAppStore で定義し ExportMenu が `res.ok`/`res.message` を参照）、`exportCsv(tabId, { scope, target })` のシグネチャが store/ExportMenu で一致。
- **プレースホルダ:** なし（全ステップに実コード）。
