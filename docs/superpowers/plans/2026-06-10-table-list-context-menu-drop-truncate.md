# テーブル一覧 右クリック DROP/TRUNCATE 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 左サイドバーのテーブル一覧項目を右クリックして、対象テーブルの TRUNCATE（空にする）/ DROP（削除）を確認付きで実行できるようにする。

**Architecture:** renderer 側で SQL を組み（`editBuilder` の純関数を拡張）、既存の `window.api.query` で実行する。新規 IPC は追加しない。確認は `window.confirm`、エラーは `window.alert`。UI は `ResultsGrid` の HTML ネイティブ・コンテキストメニュー方式を `TableList` に流用する。

**Tech Stack:** React + TypeScript, Zustand（`useAppStore`）, Vitest, CSS Modules, Electron（`window.api` 経由の IPC）。

参照スペック: `docs/superpowers/specs/2026-06-10-table-list-context-menu-drop-truncate-design.md`

---

## ファイル構成

| ファイル | 変更 | 責務 |
|---|---|---|
| `src/renderer/src/store/editBuilder.ts` | 修正 | `quoteIdent` を export 化し、`buildTruncateStatement` / `buildDropStatement`（純関数）を追加 |
| `src/renderer/src/store/editBuilder.test.ts` | 修正 | 上記2ビルダのユニットテストを追加 |
| `src/renderer/src/store/useAppStore.ts` | 修正 | `refreshTables` private ヘルパー切り出し、`truncateTable` / `dropTable` アクション追加、`AppState` 型拡張 |
| `src/renderer/src/workspace/TableList.tsx` | 修正 | 右クリックでコンテキストメニューを開き TRUNCATE/DROP を呼ぶ |
| `src/renderer/src/workspace/TableList.module.css` | 修正 | コンテキストメニューのスタイル追加 |

---

## Task 1: SQL ビルダ（TDD）

**Files:**
- Modify: `src/renderer/src/store/editBuilder.ts`
- Test: `src/renderer/src/store/editBuilder.test.ts`

`SqlStatement` 型は `editBuilder.ts` で既に import 済み（1行目）。`quoteIdent` は現状 module-private（3〜5行目）。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/store/editBuilder.test.ts` の import 行（2行目）を以下に置き換える:

```ts
import {
  buildUpdateStatements,
  buildInsertStatements,
  buildDeleteStatements,
  buildTruncateStatement,
  buildDropStatement
} from './editBuilder'
```

ファイル末尾に以下の describe ブロックを追加する:

```ts
describe('buildTruncateStatement', () => {
  it('TRUNCATE 文を組む', () => {
    expect(buildTruncateStatement('users')).toEqual({
      sql: 'TRUNCATE TABLE `users`',
      params: []
    })
  })

  it('識別子のバッククォートを2重化', () => {
    expect(buildTruncateStatement('we`ird')).toEqual({
      sql: 'TRUNCATE TABLE `we``ird`',
      params: []
    })
  })
})

describe('buildDropStatement', () => {
  it('DROP 文を組む', () => {
    expect(buildDropStatement('users')).toEqual({
      sql: 'DROP TABLE `users`',
      params: []
    })
  })

  it('識別子のバッククォートを2重化', () => {
    expect(buildDropStatement('we`ird')).toEqual({
      sql: 'DROP TABLE `we``ird`',
      params: []
    })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/editBuilder.test.ts`
Expected: FAIL（`buildTruncateStatement` / `buildDropStatement` が export されていない旨のエラー）

- [ ] **Step 3: 最小実装**

`src/renderer/src/store/editBuilder.ts` の `quoteIdent`（3〜5行目）に `export` を付け、直後に2関数を追加する:

```ts
export function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/**
 * TRUNCATE 文を組む。テーブル定義は残し全行を削除する（取り消し不可・暗黙コミット）。
 * 識別子はバッククォート2重化でエスケープ。値プレースホルダは無し。
 */
export function buildTruncateStatement(table: string): SqlStatement {
  return { sql: `TRUNCATE TABLE ${quoteIdent(table)}`, params: [] }
}

/**
 * DROP 文を組む。テーブルごと削除する（取り消し不可）。
 * 識別子はバッククォート2重化でエスケープ。値プレースホルダは無し。
 */
export function buildDropStatement(table: string): SqlStatement {
  return { sql: `DROP TABLE ${quoteIdent(table)}`, params: [] }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/renderer/src/store/editBuilder.test.ts`
Expected: PASS（既存テスト＋新規4テストが全て green）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/store/editBuilder.ts src/renderer/src/store/editBuilder.test.ts
git commit -m "feat: TRUNCATE/DROP の SQL ビルダを追加"
```

---

## Task 2: ストアアクション（truncateTable / dropTable）

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`

`useAppStore.ts` に直接のユニットテストを持たないのが既存方針（主要ロジックは Task 1 の純関数テストでカバー済み）。本タスクは実装＋`typecheck` で検証する。`pickNextActiveTabId` は18行目で import 済み、`TableTab` 型はファイル内で定義済み。

- [ ] **Step 1: editBuilder の import に2ビルダを追加**

16行目の import 文を以下に置き換える:

```ts
import {
  buildUpdateStatements,
  buildInsertStatements,
  buildDeleteStatements,
  buildTruncateStatement,
  buildDropStatement
} from './editBuilder'
```

- [ ] **Step 2: `AppState` インターフェースにアクション型を追加**

`selectTable: (name: string) => Promise<void>`（130行目）の直後に2行追加する:

```ts
    selectTable: (name: string) => Promise<void>
    truncateTable: (name: string) => Promise<void>
    dropTable: (name: string) => Promise<void>
```

- [ ] **Step 3: `refreshTables` private ヘルパーを追加**

`failTab` 関数（176〜183行目あたり）の直後、`runSql` の前に以下を追加する:

```ts
  // テーブル一覧を再取得してストアへ反映する。connect と dropTable で共有する。
  async function refreshTables(): Promise<void> {
    const tbl = await window.api.listTables()
    if (tbl.ok) set({ tables: tbl.data })
  }
```

- [ ] **Step 4: `connect` のインライン listTables を refreshTables に置き換え**

`connect` 内の以下2行（298〜299行目）:

```ts
      const tbl = await window.api.listTables()
      if (tbl.ok) set({ tables: tbl.data })
```

を1行に置き換える:

```ts
      await refreshTables()
```

- [ ] **Step 5: `truncateTable` / `dropTable` アクションを追加**

`selectTable` アクション（360〜373行目）の閉じ `},` の直後に以下を追加する:

```ts
    async truncateTable(name) {
      if (
        !window.confirm(
          `テーブル \`${name}\` を空にします。全データが削除され、取り消せません。よろしいですか？`
        )
      ) {
        return
      }
      try {
        const { sql } = buildTruncateStatement(name)
        const res = await window.api.query(sql)
        if (!res.ok) {
          window.alert(res.error.message)
          return
        }
        // 該当テーブルの開いているタブ（selectTable が同名タブを再利用するため最大1つ）の
        // ステージをクリアして再描画する。クリアしないと消えた行に対する UPDATE/DELETE が残る。
        const tab = get().tabs.find(
          (t): t is TableTab => t.kind === 'table' && t.tableName === name
        )
        if (tab) {
          patchTableTab(tab.id, (t) => ({
            ...t,
            edits: {},
            inserts: [],
            deletes: {},
            editError: null,
            selectedRowIndex: null
          }))
          await runTable(tab.id, { recount: true })
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },

    async dropTable(name) {
      if (
        !window.confirm(`テーブル \`${name}\` を削除します。この操作は取り消せません。よろしいですか？`)
      ) {
        return
      }
      try {
        const { sql } = buildDropStatement(name)
        const res = await window.api.query(sql)
        if (!res.ok) {
          window.alert(res.error.message)
          return
        }
        // 該当テーブル名のタブ（最大1つ）を確認なしで閉じる（テーブルごと消えるため編集ステージは無意味）。
        const { tabs, activeTabId } = get()
        const target = tabs.find((t) => t.kind === 'table' && t.tableName === name)
        if (target) {
          const nextActive = pickNextActiveTabId(tabs, target.id, activeTabId)
          set({ tabs: tabs.filter((t) => t.id !== target.id), activeTabId: nextActive })
        }
        await refreshTables()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },
```

- [ ] **Step 6: typecheck で検証**

Run: `npm run typecheck`
Expected: エラーなしで完了（exit 0）

- [ ] **Step 7: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: ストアに truncateTable/dropTable アクションを追加"
```

---

## Task 3: UI コンテキストメニュー

**Files:**
- Modify: `src/renderer/src/workspace/TableList.tsx`
- Modify: `src/renderer/src/workspace/TableList.module.css`

`ResultsGrid.tsx` のメニュー方式（`ctxMenu` state、`document.mousedown` で閉じる、メニュー div の `onMouseDown` stopPropagation）を踏襲する。`useEffect` / `useState` は TableList で import 済み。

- [ ] **Step 1: ストアアクションの取得を追加**

`TableList.tsx` の7〜8行目:

```tsx
  const tables = useAppStore((s) => s.tables)
  const selectTable = useAppStore((s) => s.selectTable)
```

の直後に2行追加する:

```tsx
  const truncateTable = useAppStore((s) => s.truncateTable)
  const dropTable = useAppStore((s) => s.dropTable)
```

- [ ] **Step 2: コンテキストメニュー state を追加**

`const listRef = useRef<HTMLDivElement>(null)`（13行目）の直後に追加する:

```tsx
  const [ctxMenu, setCtxMenu] = useState<{ table: string; x: number; y: number } | null>(null)
```

- [ ] **Step 3: メニューを外側クリックで閉じる useEffect を追加**

`open` 関数（42〜44行目）の直前に追加する:

```tsx
  // コンテキストメニューをページ外クリックで閉じる（ResultsGrid と同パターン）
  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

```

- [ ] **Step 4: テーブルボタンに onContextMenu を付与**

テーブルの `<button>`（88〜98行目）の `onClick={() => open(t)}` の直後の行に追加する:

```tsx
              onClick={() => open(t)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCtxMenu({ table: t, x: e.clientX, y: e.clientY })
              }}
              title={t}
```

- [ ] **Step 5: メニュー本体を描画**

`<div className={styles.list} ref={listRef}>...</div>` を閉じた直後（100行目 `</div>` の後、101行目 `</div>` の前）に追加する:

```tsx
      {ctxMenu && (
        <div
          className={styles.ctxMenu}
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className={styles.ctxItem}
            onClick={() => {
              void truncateTable(ctxMenu.table)
              setCtxMenu(null)
            }}
          >
            テーブルを空にする（TRUNCATE）
          </div>
          <div className={styles.ctxSep} />
          <div
            className={`${styles.ctxItem} ${styles.ctxDanger}`}
            onClick={() => {
              void dropTable(ctxMenu.table)
              setCtxMenu(null)
            }}
          >
            テーブルを削除（DROP）
          </div>
        </div>
      )}
```

- [ ] **Step 6: CSS を追加**

`src/renderer/src/workspace/TableList.module.css` の末尾に追加する（`ResultsGrid.module.css` を踏襲。日本語ラベル幅に合わせ `min-width` は 200px）:

```css
.ctxMenu {
  position: fixed;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 4px 0;
  z-index: 1000;
  min-width: 200px;
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

.ctxSep {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
```

- [ ] **Step 7: typecheck で検証**

Run: `npm run typecheck`
Expected: エラーなしで完了（exit 0）

- [ ] **Step 8: コミット**

```bash
git add src/renderer/src/workspace/TableList.tsx src/renderer/src/workspace/TableList.module.css
git commit -m "feat: テーブル一覧の右クリックメニューに TRUNCATE/DROP を追加"
```

---

## Task 4: 最終検証

**Files:** （変更なし。全体検証）

- [ ] **Step 1: 全テスト実行**

Run: `npm test`
Expected: 全テスト PASS（Task 1 の新規テスト含む）

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで完了（exit 0）

- [ ] **Step 3: 手動確認（MySQL 接続が必要）**

Run: `npm run dev`

確認手順:
1. 任意の接続でワークスペースを開く。
2. 左のテーブル一覧で適当なテーブルを**右クリック** → メニューが表示され「テーブルを空にする（TRUNCATE）」「テーブルを削除（DROP）」が出る。
3. メニュー外をクリック → メニューが閉じる。
4. **TRUNCATE**: そのテーブルをタブで開いた状態でメニューから TRUNCATE → 確認ダイアログ「OK」→ グリッドが0件に更新され件数も0になる。
5. **DROP**: メニューから DROP → 確認ダイアログ「OK」→ 一覧から消え、開いていたタブが閉じる。
6. **キャンセル**: 確認ダイアログで「キャンセル」→ 何も起きない。
7. **エラー**: 他テーブルから参照される（FK 制約のある）テーブルを DROP → `window.alert` でエラーメッセージが表示され、一覧・タブは変化なし。

Expected: 上記すべてが期待どおり動作する。

---

## Self-Review メモ

- **スペック網羅**: SQL ビルダ（Task 1）/ ストア `truncateTable`・`dropTable`・`refreshTables`（Task 2）/ UI メニュー・CSS（Task 3）/ 確認・エラー・後処理（Task 2 に内包）/ テスト（Task 1, 4）— スペック各項目に対応タスクあり。
- **型整合**: `buildTruncateStatement` / `buildDropStatement` の名称・シグネチャは Task 1〜3 で一致。`SqlStatement`（`{ sql, params }`）の分割代入 `{ sql }` も一致。`pickNextActiveTabId(tabs, id, activeId)` の引数順は `helpers.ts` の定義と一致。
- **プレースホルダ無し**: 全ステップに実コード・実コマンド・期待結果を記載。
