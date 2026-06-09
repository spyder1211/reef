# テーブル検索・ジャンプ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サイドバーのテーブル一覧にインクリメンタル検索・キーボードジャンプ・⌘P フォーカスショートカットを追加し、SQL を書かずに目的のテーブルへ素早く到達できるようにする。

**Architecture:** 純粋ロジック（`filterTables` / `matchRange`）を `lib/tableSearch.ts` に切り出してユニットテストし、`TableList.tsx` をその上で検索ボックス・キーボードナビ・ハイライト・⌘P リスナーを持つ自己完結コンポーネントに拡張する。ストア・IPC・メイン・preload は無変更。

**Tech Stack:** React 18 + TypeScript（CSS Modules）、vitest、zustand（参照のみ）。

**関連**: issue #10 / spec `docs/superpowers/specs/2026-06-09-table-search-jump-design.md`

---

## File Structure

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/renderer/src/lib/tableSearch.ts` | 新規 | `filterTables` / `matchRange`（純粋関数） |
| `src/renderer/src/lib/tableSearch.test.ts` | 新規 | 上記のユニットテスト |
| `src/renderer/src/workspace/TableList.tsx` | 変更 | 検索ボックス・キーボードナビ・ハイライト・⌘P リスナー |
| `src/renderer/src/workspace/TableList.module.css` | 変更 | 検索ボックス・ハイライト・アクティブ行スタイル |

---

## Task 1: 純粋ロジック `tableSearch.ts`（TDD）

**Files:**
- Create: `src/renderer/src/lib/tableSearch.ts`
- Test: `src/renderer/src/lib/tableSearch.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/tableSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterTables, matchRange } from './tableSearch'

describe('filterTables', () => {
  const tables = ['users', 'user_roles', 'orders', 'ORDER_items', 'audit_log']

  it('空クエリは全件をそのまま返す', () => {
    expect(filterTables(tables, '')).toEqual(tables)
  })
  it('空白のみクエリも全件', () => {
    expect(filterTables(tables, '   ')).toEqual(tables)
  })
  it('大文字小文字を無視して部分一致', () => {
    expect(filterTables(tables, 'user')).toEqual(['users', 'user_roles'])
    expect(filterTables(tables, 'ORDER')).toEqual(['orders', 'ORDER_items'])
  })
  it('一致しないものは除外', () => {
    expect(filterTables(tables, 'xyz')).toEqual([])
  })
  it('特殊文字は literal 扱い（正規表現にならない）', () => {
    expect(filterTables(['a.b', 'axb', 'a_b'], '.')).toEqual(['a.b'])
    expect(filterTables(['a_b', 'axb'], '_')).toEqual(['a_b'])
  })
  it('前後空白はトリムして一致', () => {
    expect(filterTables(tables, '  user  ')).toEqual(['users', 'user_roles'])
  })
})

describe('matchRange', () => {
  it('先頭一致', () => {
    expect(matchRange('users', 'use')).toEqual({ start: 0, end: 3 })
  })
  it('中間一致', () => {
    expect(matchRange('user_roles', 'rol')).toEqual({ start: 5, end: 8 })
  })
  it('末尾一致', () => {
    expect(matchRange('audit_log', 'log')).toEqual({ start: 6, end: 9 })
  })
  it('大文字小文字を無視', () => {
    expect(matchRange('ORDER_items', 'order')).toEqual({ start: 0, end: 5 })
  })
  it('空クエリ・空白のみは null', () => {
    expect(matchRange('users', '')).toBeNull()
    expect(matchRange('users', '   ')).toBeNull()
  })
  it('一致なしは null', () => {
    expect(matchRange('users', 'xyz')).toBeNull()
  })
  it('前後空白付きクエリでも end-start はトリム後の長さ', () => {
    expect(matchRange('user_roles', '  rol  ')).toEqual({ start: 5, end: 8 })
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm run test -- src/renderer/src/lib/tableSearch.test.ts`
Expected: FAIL（`Failed to resolve import "./tableSearch"` または `filterTables is not a function`）

- [ ] **Step 3: 最小実装を書く**

`src/renderer/src/lib/tableSearch.ts`:

```ts
// サイドバーのテーブル検索ロジック（純粋関数）。DB に触れずクライアント内で完結する。

// 大文字小文字を無視した部分一致でテーブル名を絞り込む。
// query が空／空白のみなら入力配列をそのまま返す。
export function filterTables(tables: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (q === '') return tables
  return tables.filter((name) => name.toLowerCase().includes(q))
}

// 最初の一致範囲 [start, end) を返す（ハイライト描画用）。
// query が空／空白のみ、または一致しない場合は null。
// indexOf ベースのため正規表現エスケープ不要（特殊文字も literal 扱い）。
export function matchRange(
  name: string,
  query: string
): { start: number; end: number } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return null
  const start = name.toLowerCase().indexOf(q)
  if (start === -1) return null
  return { start, end: start + q.length }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm run test -- src/renderer/src/lib/tableSearch.test.ts`
Expected: PASS（13 アサーション）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/lib/tableSearch.ts src/renderer/src/lib/tableSearch.test.ts
git commit -m "feat: テーブル検索の純粋ロジック filterTables/matchRange を追加 (#10)"
```

---

## Task 2: `TableList` を検索対応に拡張

**Files:**
- Modify: `src/renderer/src/workspace/TableList.tsx`（全面置き換え）
- Modify: `src/renderer/src/workspace/TableList.module.css`（追記・一部変更）

> このタスクのキーボード挙動（↑↓/Enter/Esc）と ⌘P は手動確認する（既存方針＝純粋ロジックのみ自動テスト）。

- [ ] **Step 1: `TableList.tsx` を全面置き換え**

`src/renderer/src/workspace/TableList.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../store/useAppStore'
import { filterTables, matchRange } from '../lib/tableSearch'
import styles from './TableList.module.css'

export default function TableList(): JSX.Element {
  const tables = useAppStore((s) => s.tables)
  const selectTable = useAppStore((s) => s.selectTable)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 入力に応じたフィルタ済みリスト。tables か query が変わったときだけ再計算。
  const filtered = useMemo(() => filterTables(tables, query), [tables, query])

  // クエリ変更でアクティブ行を先頭へ戻す（リストが縮んだときの位置ずれも解消）。
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // ⌘P（macOS）/ Ctrl+P（その他）で検索ボックスへフォーカスし既存テキストを全選択。
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // アクティブ行を表示範囲内へスクロール。
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const open = (name: string): void => {
    void selectTable(name)
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const name = filtered[activeIndex] ?? filtered[0]
      if (name) open(name)
    } else if (e.key === 'Escape') {
      // 二段挙動: 入力があればクリア、空ならフォーカスを外す。
      if (query !== '') setQuery('')
      else inputRef.current?.blur()
    }
  }

  return (
    <div className={styles.tables}>
      <div className={styles.label}>TABLES</div>
      {tables.length > 0 && (
        <input
          ref={inputRef}
          className={styles.search}
          value={query}
          placeholder="テーブルを検索…（⌘P）"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      )}
      <div className={styles.list} ref={listRef}>
        {tables.length === 0 ? (
          <div className={styles.empty}>テーブルがありません</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>該当なし</div>
        ) : (
          filtered.map((t, i) => (
            <button
              key={t}
              data-index={i}
              className={i === activeIndex ? `${styles.row} ${styles.active}` : styles.row}
              onClick={() => open(t)}
              onMouseEnter={() => setActiveIndex(i)}
              title={t}
            >
              <span className={styles.icon}>▸</span>
              <span className={styles.tname}>{renderName(t, query)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// テーブル名を一致部分でハイライト分割する。query が空／一致なしならそのまま表示。
function renderName(name: string, query: string): JSX.Element {
  const range = matchRange(name, query)
  if (!range) return <>{name}</>
  return (
    <>
      {name.slice(0, range.start)}
      <mark className={styles.hl}>{name.slice(range.start, range.end)}</mark>
      {name.slice(range.end)}
    </>
  )
}
```

- [ ] **Step 2: `TableList.module.css` を更新**

`.tables` を flex 縦並びに変え、スクロールを内側の `.list` へ移す。検索ボックス・ハイライト・アクティブ行のスタイルを追加する。ファイル全体を以下に置き換える:

```css
.tables {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 8px 12px;
}
.label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 6px 8px 4px;
}
.search {
  margin: 2px 4px 6px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 12.5px;
  outline: none;
}
.search:focus {
  border-color: var(--accent);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12.5px;
  color: var(--text);
  text-align: left;
}
.row:hover {
  background: #e9e9ee;
}
.active,
.active:hover {
  background: rgba(10, 108, 255, 0.12);
}
.icon {
  color: var(--text-faint);
  font-size: 10px;
}
.tname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hl {
  background: rgba(10, 108, 255, 0.22);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
}
.empty {
  color: var(--text-faint);
  font-size: 12px;
  padding: 8px;
}
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: PASS（エラーなし）

- [ ] **Step 4: テストスイートで回帰がないことを確認**

Run: `npm run test`
Expected: PASS（既存テスト全件＋ Task 1 の tableSearch テスト）

- [ ] **Step 5: 手動確認（dev 起動）**

Run: `npm run dev`
確認項目（接続して任意の DB を開いた状態で）:
- 検索ボックスに入力すると一覧が絞り込まれ、一致部分がハイライトされる。
- `↓`/`↑` でアクティブ行が動き、端でクランプ（先頭で↑・末尾で↓しても飛び出さない）。アクティブ行が見えるようスクロールする。
- `Enter` でアクティブ行のテーブルが開く（クエリとフォーカスは維持）。
- `Esc` は 1 回目でクエリをクリア、空の状態でもう一度押すとフォーカスが外れる。
- `⌘P` でどこからでも検索ボックスにフォーカスし、既存テキストが全選択される。
- 一致 0 件で「該当なし」、テーブル 0 件で「テーブルがありません」。
- マウスクリックでも従来どおりテーブルが開く。

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/workspace/TableList.tsx src/renderer/src/workspace/TableList.module.css
git commit -m "feat: サイドバーにテーブル検索・キーボードジャンプ・⌘P フォーカスを追加 (#10)"
```

---

## Task 3: 最終検証（型・テスト・ビルド）

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

- **Spec coverage**: インクリメンタル検索＝Task 2 Step1/2、キーボードジャンプ（↑↓/Enter/Esc）＝Task 2 Step1、⌘P ショートカット＝Task 2 Step1、ハイライト＝Task 2 `renderName`＋`.hl`、純粋ロジック＋テスト＝Task 1、空/該当なし＝Task 2 Step1。spec の全要件にタスクが対応。
- **Placeholder scan**: TODO/TBD なし。各コード片は最終形を記載。
- **Type consistency**: `filterTables(tables, query)` / `matchRange(name, query): {start, end} | null` は Task 1 と Task 2 で一致。`renderName(name, query)` の戻りは `JSX.Element`。`data-index` セレクタと `activeIndex` の型（number）整合。
