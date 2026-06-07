# テーブルビューの行追加（INSERT）/ 行削除（DELETE）— 設計ドキュメント

**日付**: 2026-06-07
**ステータス**: 承認済み（実装計画へ移行）

## 1. 目的

テーブルビューで行の追加（INSERT）と削除（DELETE）を行えるようにする。PR #3 で実装したセル編集（UPDATE）と同じステージング基盤（`applyChanges` / `EditBar` / `⌘S` コミット）の上に構築し、UIの一貫性を保つ。

## 2. スコープ

- **対象**: テーブルビュー（`TableTab`）かつ**主キーがあるテーブル**のみ。主キーなしテーブルは引き続き読み取り専用。
- **コミット方式**: ステージング一括。`⌘S` で INSERT / UPDATE / DELETE をまとめて1トランザクションとしてコミット。
- **対象外**: SQL タブ、複数行同時選択（v1 では1行ずつ）。

## 3. アーキテクチャ

### 3.1 データモデル（`src/shared/types.ts` に追加）

```ts
// INSERT ステージング中の1行
export interface PendingInsert {
  localId: string                          // ローカル一意ID（"ins-0", "ins-1" …）
  values: Record<string, string | null>    // 列名 → 入力値（省略列は含めない）
}
```

`TableTab`（`useAppStore.ts`）に追加:

```ts
inserts: PendingInsert[]                          // INSERT ステージング（順序保証のため配列）
deletes: Record<string, Record<string, unknown>>  // 行キー → pk値（DELETE ステージング）
```

`makeTableTab` は `inserts: [], deletes: {}` で初期化。

### 3.2 SQL 生成（`src/renderer/src/store/editBuilder.ts` に追加）

**INSERT 文の生成:**

```ts
// values が空の行はスキップ。省略列（空欄）は SQL に含めない（DB デフォルト値を使う）。
export function buildInsertStatements(
  table: string,
  inserts: PendingInsert[]
): SqlStatement[]
```

生成例:

```sql
INSERT INTO `users` (`name`, `email`) VALUES (?, ?)
-- params: ['新田 花子', null]
```

ルール:
- 入力値が空文字列の列は INSERT 文から除外（DB のデフォルト値 / AUTO_INCREMENT に委ねる）
- `null` は明示的に `null` を param として渡す（mysql2 が `NULL` を生成）
- 識別子はバッククォート2重化でエスケープ（`quoteIdent`）
- `values` が空の PendingInsert はスキップ

**DELETE 文の生成:**

```ts
// 各 delete エントリを1つの DELETE 文にする。
export function buildDeleteStatements(
  table: string,
  primaryKey: string[],
  deletes: Record<string, Record<string, unknown>>
): SqlStatement[]
```

生成例:

```sql
DELETE FROM `users` WHERE `id` = ?
-- params: [6]
```

複合主キーは `AND` 結合。値は `deletes[rowKey]`（オリジナルの pk 値）を使う。

### 3.3 `commitEdits` の変更（`useAppStore.ts`）

実行順序: **DELETE → UPDATE → INSERT**（FK 制約違反を最小化）。

```ts
const statements = [
  ...buildDeleteStatements(tab.tableName, tab.primaryKey, tab.deletes),
  ...buildUpdateStatements(tab.tableName, tab.primaryKey, Object.values(tab.edits)),
  ...buildInsertStatements(tab.tableName, tab.inserts),
]
```

`applyChanges(statements)` に一括送信。成功後:
- `edits = {}, inserts = [], deletes = {}` をリセット
- `selectedRowIndex: null`（行位置がずれるため）
- `recount: true` で再取得（INSERT/DELETE は行数が変わる）

失敗時: `editError` にエラーを設定し、ステージングは保持（再試行可能）。

### 3.4 ストアのアクション（追加 / 変更）

**追加:**

```ts
addInsertRow: (tabId: string) => void
// inserts に { localId: `ins-${Date.now()}`, values: {} } を追加

updateInsertCell: (tabId: string, localId: string, column: string, value: string) => void
// 指定 localId の PendingInsert の values[column] を更新

removeInsertRow: (tabId: string, localId: string) => void
// inserts から指定 localId を削除

stageDelete: (tabId: string, rowKey: string, pkValues: Record<string, unknown>) => void
// deletes[rowKey] = pkValues。すでにある場合は取り消し（トグル）

discardEdits: (tabId: string) => void  // 変更: edits / inserts / deletes をすべてリセット
```

**変更:**

`setPage` / `setSort` / `setPageSize` / `applyFilters` の保護条件を拡張:

```ts
// 変更前
Object.keys(tab.edits).length > 0
// 変更後
Object.keys(tab.edits).length > 0 || tab.inserts.length > 0 || Object.keys(tab.deletes).length > 0
```

### 3.5 UI

#### `FilterBar.tsx`（変更）

編集可能テーブル（`tab.primaryKey.length > 0`）のとき、フィルター行の右端に「＋ 行を追加」ボタンを追加。クリックで `addInsertRow(tabId)` を呼ぶ。

#### `ResultsGrid.tsx`（変更）

**INSERT 行の表示:**
- `result.rows`（既存行）の下に `inserts` の各行を追加表示
- 緑ハイライト（`styles.insertRow`）で区別
- 主キー列は「auto」（イタリック）で表示（AUTO_INCREMENT 等のデフォルト値）
- セルのダブルクリックで `updateInsertCell` を呼ぶ（既存のインライン editing と同じ仕組み）
- INSERT 行をクリック選択可（`selectedRowIndex` は `result.rows.length + insertIndex`）

**DELETE 行の表示:**
- `deletes` に含まれる行は取り消し線＋赤ハイライト（`styles.deleteRow`）

**右クリックコンテキストメニュー:**
- 行の `onContextMenu` で React state（`contextMenu: { x, y, rowKey, insertLocalId } | null`）を更新
- 画面上に絶対配置の `<div>` でメニューを表示（ライブラリ不使用）
- メニュー内容:
  - 通常行（削除されていない）: 「行を削除」→ `stageDelete(tabId, rowKey, pkValues)`
  - DELETE ステージング済み行: 「削除を取り消す」→ `stageDelete(tabId, rowKey, pkValues)`（トグル）
  - INSERT 行: 「この新規行を破棄」→ `removeInsertRow(tabId, localId)`
- ページ外クリックでメニューを閉じる

**INSERT 行選択時の DetailPane:** `selectedRowIndex >= result.rows.length` のとき、DetailPane は「新規行はグリッドで編集してください」と表示するのみ（v1 はペイン編集非対応）。

#### `EditBar.tsx`（変更）

INSERT / DELETE のカウントも含めた表示:

```
● 未コミットの変更: UPDATE 2件 / INSERT 1行 / DELETE 1行
```

各カウントは 0 のとき省略。表示条件は `editCount > 0 || inserts.length > 0 || Object.keys(deletes).length > 0`。

#### `ResultsGrid.module.css`（変更）

```css
.insertRow { background: #f0fff4 !important; }
.deleteRow { background: #fff0f0 !important; text-decoration: line-through; color: #c0392b; }
.contextMenu { position: fixed; background: #fff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.18); padding: 4px 0; z-index: 1000; min-width: 160px; }
.contextMenuItem { padding: 6px 14px; cursor: pointer; font-size: 12px; }
.contextMenuItem:hover { background: #2f7bf6; color: #fff; }
.contextMenuDanger { color: #ff3b30; }
.contextMenuDanger:hover { background: #ff3b30; color: #fff; }
```

## 4. エラーハンドリング

- コミット失敗: トランザクション全体をロールバック。`normalizeDbError` 経由のエラーを `editError` に設定し EditBar に表示。ステージングを保持して再試行可能。
- INSERT で列の型不一致 / NOT NULL 制約違反 / 重複キー: 上記のロールバックフローで処理。
- `primaryKey` なしテーブル: 引き続き編集 UI を無効化（INSERT/DELETE ボタン非表示）。

## 5. テスト

**`editBuilder` ユニット（DB 不要）:**
- `buildInsertStatements`: 単一列 / 複数列 / 空欄列を除外 / null 値 / 識別子エスケープ / `values` 空の行はスキップ
- `buildDeleteStatements`: 単一 PK / 複合 PK の WHERE 結合 / 識別子エスケープ / 空 deletes は空配列

**結合テスト（docker MySQL、gated）:**
- `applyChanges` で INSERT → 行が増える
- `applyChanges` で DELETE → 行が減る
- INSERT + DELETE + UPDATE の混合トランザクションが正しく適用される
- 失敗を含む文を渡すと全ロールバックされる（部分適用されない）

## 6. 既知の制約（v1 で許容）

- 複数行同時削除は未対応（1行ずつ右クリックでステージング）
- INSERT 行の DetailPane 編集は未対応（グリッドのインライン編集のみ）
- INSERT 時の入力はすべて文字列ベース（mysql2 が列型に合わせて変換）
- ページ移動・ソート・フィルタ変更で未コミット INSERT/DELETE は破棄（confirm で確認）

## 7. ファイル一覧

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/shared/types.ts` | 変更 | `PendingInsert` 型を追加 |
| `src/renderer/src/store/editBuilder.ts` | 変更 | `buildInsertStatements` / `buildDeleteStatements` を追加 |
| `src/renderer/src/store/editBuilder.test.ts` | 変更 | INSERT / DELETE 文生成のユニットテスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | `TableTab` 拡張・INSERT / DELETE アクション・ナビ保護拡張・`commitEdits` 拡張 |
| `src/renderer/src/workspace/FilterBar.tsx` | 変更 | 「＋ 行を追加」ボタンを追加 |
| `src/renderer/src/workspace/FilterBar.module.css` | 変更 | ボタンのスタイル |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | INSERT 行表示・DELETE ハイライト・右クリックコンテキストメニュー |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | INSERT / DELETE / contextMenu スタイル |
| `src/renderer/src/workspace/EditBar.tsx` | 変更 | INSERT / DELETE カウント表示 |
| `src/renderer/src/workspace/DetailPane.tsx` | 変更 | INSERT 行選択時の「ペイン編集非対応」表示 |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | INSERT / DELETE / 混合トランザクション結合テスト |
