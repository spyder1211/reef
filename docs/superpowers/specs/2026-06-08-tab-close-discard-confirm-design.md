# タブクローズ時の未コミット変更 破棄確認 設計

作成日: 2026-06-08

## 背景

テーブルビューのセル編集（UPDATE）/ 行追加（INSERT）/ 行削除（DELETE）はステージング方式で、`⌘S`（`commitEdits`）まで DB に反映されない。ステージング中の変更は `TableTab` の `edits` / `inserts` / `deletes` に保持される。

ページ移動・ソート・フィルタ変更（`applyFilters` / `setSort` / `setPage` / `setPageSize`）は、ナビゲーション前に `confirmDiscard` で破棄確認を出す。しかし `closeTab` は確認なしでタブごと破棄するため、**ステージ済みの未コミット変更が無警告で失われる**（データ損失）。本変更でこれを塞ぐ。

## スコープ

対象は **`closeTab` のみ**。

| 操作 | 挙動 | 確認 | 理由 |
|---|---|---|---|
| `closeTab`（タブを閉じる） | タブ state ごと破棄 | **追加する** | 変更が完全に失われる＝実データ損失 |
| `setActiveTab`（タブ切替） | `activeTabId` を変えるだけ | 追加しない | タブ state はメモリに残り、変更は失われない |
| `selectTable`（既存タブへ切替） | `activeTabId` を変えるだけ | 追加しない | 同上 |

タブ「切替」では切り替え後もステージング変更がメモリに残り続けるため、確認は不要（出すとむしろ煩わしい）。一般的な DB クライアント（TablePlus 等）も切替では確認せず、閉じるときだけ確認する。

## 設計

### 1. 判定の純粋関数化（`src/renderer/src/store/helpers.ts`）

未コミット変更の有無判定を純粋関数として切り出し、ユニットテスト可能にする。

```ts
export function hasUncommittedChanges(tab: Tab): boolean
```

- `TableTab` で `edits` / `inserts` / `deletes` のいずれかが非空なら `true`。
- `SqlTab` は常に `false`（DB への未コミット変更という概念がない。SQL テキストは実行前で、閉じても DB 影響はない）。

既存 `confirmDiscard`（`useAppStore.ts` 内のインライン判定）も、この関数を使うようリファクタする（挙動不変）。これにより破棄判定ロジックが 1 箇所に集約され、`confirmDiscard`（ページ/ソート/フィルタ用）と `closeTab` の双方が同じ判定を共有する。

引数の型: `helpers.ts` は現在 `Tab` 型に依存していないため、`hasUncommittedChanges` は構造的に必要な最小フィールド（`kind` と `edits` / `inserts` / `deletes`）だけを受ける型シグネチャとし、`useAppStore.ts` の `Tab` 型と循環依存を作らない。

### 2. `closeTab` に確認を追加（`src/renderer/src/store/useAppStore.ts`）

```ts
closeTab(id) {
  const { tabs, activeTabId } = get()
  const target = tabs.find((t) => t.id === id)
  if (target && hasUncommittedChanges(target)) {
    if (!window.confirm('未コミットの変更があります。破棄してタブを閉じますか？')) return
  }
  const nextActive = pickNextActiveTabId(tabs, id, activeTabId)
  set({ tabs: tabs.filter((t) => t.id !== id), activeTabId: nextActive })
}
```

- 閉じる対象は **`id` で指定されたタブ**（アクティブとは限らない。各タブの×ボタンから非アクティブなタブも閉じられるため、アクティブタブではなく「閉じる対象タブ」の変更を見る）。
- 確認文言: **`未コミットの変更があります。破棄してタブを閉じますか？`**（`confirmDiscard` の「移動しますか？」とは別文言。閉じる文脈に合わせる）。
- キャンセル（`window.confirm` が `false`）時は何もしない＝タブは残り、変更も保持。
- `SqlTab` および変更なし `TableTab` は確認なしで即閉じ（既存挙動と変化なし）。

## エラーハンドリング

- 該当タブが見つからない（`target` が `undefined`）場合は確認をスキップし、既存どおり何もしない（`filter` で結果が変わらない）。
- `window.confirm` は同期 API。非同期処理は介在しない。

## テスト

`src/renderer/src/store/helpers.test.ts` に `hasUncommittedChanges` のテストを追加する。

- `edits` が非空 → `true`
- `inserts` が非空 → `true`
- `deletes` が非空 → `true`
- `TableTab` で 3 つすべて空 → `false`
- `SqlTab` → `false`

`closeTab` 本体は `window.confirm` に依存するため、判定ロジックを純粋関数に分離したことで網羅対象は `hasUncommittedChanges` のテストでカバーされる。`closeTab` の `window.confirm` 呼び出し有無の検証はユニットテスト対象外とする（既存方針＝`useAppStore.ts` に直接のユニットテストを持たない、に合わせる）。

## 非スコープ

- `setActiveTab` / `selectTable` 切替時の確認（上記理由により対象外）。
- 「保存して閉じる / 破棄して閉じる / キャンセル」の 3 択カスタムモーダル（YAGNI。`window.confirm` の 2 択で十分）。
- アプリ終了・ウィンドウクローズ時の一括確認（別件）。
