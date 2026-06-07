# タブクローズ時の破棄確認 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タブを閉じる（`closeTab`）際にステージング中の未コミット変更（UPDATE/INSERT/DELETE）があれば破棄確認を出し、無警告のデータ損失を防ぐ。

**Architecture:** 未コミット変更の有無判定を純粋関数 `hasUncommittedChanges` として `helpers.ts` に切り出してユニットテストする。`useAppStore.ts` の `closeTab` でこの関数を使って `window.confirm` を出し、既存 `confirmDiscard` も同関数を使うようリファクタして判定ロジックを 1 箇所に集約する。タブ「切替」（`setActiveTab`/`selectTable`）はタブ state がメモリに残り変更が失われないため対象外。

**Tech Stack:** TypeScript, Zustand, Vitest, Electron (renderer)

設計: `docs/superpowers/specs/2026-06-08-tab-close-discard-confirm-design.md`

---

### Task 1: `hasUncommittedChanges` 純粋関数

**Files:**
- Modify: `src/renderer/src/store/helpers.ts`
- Test: `src/renderer/src/store/helpers.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/store/helpers.test.ts` の先頭の import に `hasUncommittedChanges` を追加する:

```ts
import { filterProfiles, pickNextActiveTabId, hasUncommittedChanges } from './helpers'
```

ファイル末尾（`describe('initials', ...)` の後）に以下を追加する:

```ts
describe('hasUncommittedChanges', () => {
  const emptyTable = { kind: 'table', edits: {}, inserts: [], deletes: {} }
  it('edits が非空なら true', () => {
    expect(
      hasUncommittedChanges({ ...emptyTable, edits: { k: { pk: {}, values: {} } } })
    ).toBe(true)
  })
  it('inserts が非空なら true', () => {
    expect(
      hasUncommittedChanges({ ...emptyTable, inserts: [{ localId: 'x', values: {} }] })
    ).toBe(true)
  })
  it('deletes が非空なら true', () => {
    expect(hasUncommittedChanges({ ...emptyTable, deletes: { k: {} } })).toBe(true)
  })
  it('TableTab で 3 つすべて空なら false', () => {
    expect(hasUncommittedChanges(emptyTable)).toBe(false)
  })
  it('SqlTab は常に false', () => {
    expect(hasUncommittedChanges({ kind: 'sql' })).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/renderer/src/store/helpers.test.ts`
Expected: FAIL（`hasUncommittedChanges` is not a function / export がない旨）

- [ ] **Step 3: 最小実装を書く**

`src/renderer/src/store/helpers.ts` の末尾に追加する。`useAppStore.ts` の `Tab` 型を import すると循環依存になるため、構造的に必要な最小フィールドだけを受ける型シグネチャにする:

```ts
// 未コミットのステージング変更（UPDATE/INSERT/DELETE）があるか。
// SqlTab には該当概念がないため常に false。
// useAppStore の Tab 型を import すると循環依存になるため構造的型で受ける。
export function hasUncommittedChanges(tab: {
  kind: string
  edits?: Record<string, unknown>
  inserts?: unknown[]
  deletes?: Record<string, unknown>
}): boolean {
  if (tab.kind !== 'table') return false
  return (
    Object.keys(tab.edits ?? {}).length > 0 ||
    (tab.inserts ?? []).length > 0 ||
    Object.keys(tab.deletes ?? {}).length > 0
  )
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/renderer/src/store/helpers.test.ts`
Expected: PASS（`hasUncommittedChanges` の 5 ケースすべて緑）

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/store/helpers.ts src/renderer/src/store/helpers.test.ts
git commit -m "feat: 未コミット変更判定 hasUncommittedChanges を helpers に追加"
```

---

### Task 2: `closeTab` に破棄確認を追加 + `confirmDiscard` リファクタ

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts:16`（import）
- Modify: `src/renderer/src/store/useAppStore.ts:143-150`（`confirmDiscard`）
- Modify: `src/renderer/src/store/useAppStore.ts:308-312`（`closeTab`）

> `closeTab` 本体は `window.confirm` に依存するため、ユニットテストは追加しない（既存方針＝`useAppStore.ts` に直接のユニットテストを持たない）。判定ロジックは Task 1 の `hasUncommittedChanges` テストでカバー済み。検証は typecheck・lint・全テストグリーンで行う。

- [ ] **Step 1: import に `hasUncommittedChanges` を追加**

`src/renderer/src/store/useAppStore.ts:16` の行を置換する。

変更前:
```ts
import { pickNextActiveTabId } from './helpers'
```
変更後:
```ts
import { pickNextActiveTabId, hasUncommittedChanges } from './helpers'
```

- [ ] **Step 2: `confirmDiscard` を `hasUncommittedChanges` を使うようリファクタ**

`src/renderer/src/store/useAppStore.ts:143-150` を置換する。

変更前:
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
変更後:
```ts
  function confirmDiscard(tab: TableTab): boolean {
    if (!hasUncommittedChanges(tab)) return true
    return window.confirm('未コミットの変更があります。破棄して移動しますか？')
  }
```

- [ ] **Step 3: `closeTab` に確認を追加**

`src/renderer/src/store/useAppStore.ts:308-312` を置換する。

変更前:
```ts
    closeTab(id) {
      const { tabs, activeTabId } = get()
      const nextActive = pickNextActiveTabId(tabs, id, activeTabId)
      set({ tabs: tabs.filter((t) => t.id !== id), activeTabId: nextActive })
    },
```
変更後:
```ts
    closeTab(id) {
      const { tabs, activeTabId } = get()
      // 閉じる対象は id 指定のタブ（アクティブとは限らない）。未コミット変更があれば確認する。
      const target = tabs.find((t) => t.id === id)
      if (target && hasUncommittedChanges(target)) {
        if (!window.confirm('未コミットの変更があります。破棄してタブを閉じますか？')) return
      }
      const nextActive = pickNextActiveTabId(tabs, id, activeTabId)
      set({ tabs: tabs.filter((t) => t.id !== id), activeTabId: nextActive })
    },
```

- [ ] **Step 4: typecheck を実行**

Run: `npm run typecheck`
Expected: エラーなしで完了（`Tab`（union）を `hasUncommittedChanges` の構造的型に渡せること、`TableTab` の `edits`/`inserts`/`deletes` が代入互換であることを確認）

- [ ] **Step 5: 全テストを実行**

Run: `npm test`
Expected: 既存テスト + Task 1 のテストがすべて PASS

- [ ] **Step 6: コミット**

```bash
git add src/renderer/src/store/useAppStore.ts
git commit -m "feat: タブを閉じる際に未コミット変更の破棄確認を追加"
```

---

## 動作確認（手動・任意）

実装後、`npm run dev` で実際に確認できる（任意）:

1. テーブルを開き、セルを編集 / 行を追加 / 行を削除してステージング状態にする。
2. そのタブの×ボタンで閉じる → 「未コミットの変更があります。破棄してタブを閉じますか？」が出る。
   - キャンセル → タブが残り、変更も保持される。
   - OK → タブが閉じる。
3. 変更なしのタブを閉じる → 確認なしで即閉じる。
4. SQL タブを閉じる → 確認なしで即閉じる。
5. ステージング中に別タブへ切替 / テーブルツリーで別テーブルへ切替 → 確認は出ず、元タブに戻ると変更が保持されている（対象外の確認）。
