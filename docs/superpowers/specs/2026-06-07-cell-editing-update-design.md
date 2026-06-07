# テーブルビューのセル編集（UPDATE）— 設計ドキュメント

**日付**: 2026-06-07
**ステータス**: 承認済み（実装計画へ移行）

## 1. 目的

テーブルビュー（サイドバーでテーブルを選んで開くタブ）で、グリッドのセルを直接編集して既存行を更新（UPDATE）できるようにする。TablePlus と同様、複数の変更をためて（ステージング）一括コミットする。

## 2. スコープ

- **対象**: テーブルビュー（`TableTab`）かつ**主キーがあるテーブル**のみ編集可能。主キーがないテーブルは「主キーがないため編集できません」と表示して読み取り専用。
- **対象外（今回）**: 行の追加（INSERT）・行の削除（DELETE）は次の spec で同じ編集基盤の上に追加する。SQL タブ（手書き SQL）は対象外。
- **コミット方式**: ステージング一括。複数セルを編集して変更をため、`⌘S` で1トランザクションとして一括コミット、または破棄。

## 3. アーキテクチャ

### 3.1 主キー検出（main 側）

`src/main/connection/ConnectionManager.ts` に追加:

```ts
// 主キー列名を Seq_in_index 順で返す。主キーがなければ []（複合主キー対応）。
async primaryKey(table: string): Promise<string[]>
```

実装: `SHOW KEYS FROM \`<table>\` WHERE Key_name = 'PRIMARY'` を実行し、`Seq_in_index` の昇順に `Column_name` を集める。`SHOW KEYS` はテーブル名にプレースホルダを使えないため、テーブル名はバッククォート2重化でエスケープして埋め込む（テーブル名はスキーマ由来）。

IPC: `src/main/ipc/registerDbHandlers.ts` に `db:primaryKey` を追加 → `ApiResult<string[]>`。

### 3.2 一括コミット（main 側・トランザクション）

`ConnectionManager` に追加:

```ts
// 複数の文を1トランザクションで適用。失敗時は全ロールバック。合計 affectedRows を返す。
async applyChanges(statements: { sql: string; params: unknown[] }[]): Promise<{ affectedRows: number }>
```

実装: `pool.getConnection()` → `conn.beginTransaction()` → 各 `conn.query(sql, params)` を順に実行し `affectedRows` を加算 → `conn.commit()`。途中で例外が出たら `conn.rollback()` して再 throw。`finally` で `conn.release()`。

IPC: `db:applyChanges(statements)` を追加 → `ApiResult<{ affectedRows: number }>`。

> レンダラが SQL を組み立てて渡す方針は、既存の `filterBuilder`（レンダラで SELECT を生成）と一貫している。レンダラは元々 SQL タブで任意 SQL を実行できる信頼境界であり、追加のリスクはない。

### 3.3 UPDATE 文の組み立て（`src/renderer/src/store/editBuilder.ts` 新規・純粋関数）

共有型 `RowEdit` を `src/shared/types.ts` に定義し、`editBuilder.ts` と `useAppStore.ts` の両方から import する:

```ts
// src/shared/types.ts
export interface RowEdit {
  pk: Record<string, unknown>            // オリジナル行の主キー列 → 値（WHERE 用）
  values: Record<string, string | null>  // 変更された列 → 新しい値（SET 用）
}
```

`editBuilder.ts` 本体:

```ts
import type { RowEdit } from '../../../shared/types'

// 各 RowEdit を1つの UPDATE 文にする。values が空の行はスキップ。
export function buildUpdateStatements(
  table: string,
  primaryKey: string[],
  edits: RowEdit[]
): { sql: string; params: unknown[] }[]
```

生成例:

```sql
UPDATE `users` SET `name` = ?, `status` = ? WHERE `id` = ?
-- params: ['山田太郎', null, 2]
```

ルール:
- **値は必ず `?` プレースホルダ**。識別子（table / 列名）はバッククォート2重化でエスケープ（`quoteIdent`）。
- `WHERE` は `primaryKey` の各列を `AND` で結び、値は `edit.pk`（**編集前のオリジナル値**）を使う。これにより主キー列を編集しても旧主キーで行を特定できる。
- `SET` の値が `null` のときは param に `null` を渡す（mysql2 が `SET col = NULL` を生成）。
- `values` が空の行（実質変更なし）はスキップ。
- `primaryKey` が空の場合は呼び出し側が編集を許可しない前提（防御的に空配列を返す）。

### 3.4 行キー生成（`src/renderer/src/store/rowKey.ts` 新規・純粋関数）

ステージング中の変更は「行キー」で管理する。ページ送りやソートで行配列が変わっても、同じ行を一意に指せるようオリジナルの主キー値から生成する。

```ts
// 主キー列のオリジナル値から安定した文字列キーを生成。
export function rowKeyOf(primaryKey: string[], row: Record<string, unknown>): string
```

実装: `JSON.stringify(primaryKey.map((c) => row[c]))`。

### 3.5 状態（`TableTab` に追加）

`src/renderer/src/store/useAppStore.ts` の `TableTab` に追加:

```ts
primaryKey: string[]            // 主キー列（空 = 読み取り専用）
edits: Record<string, RowEdit>  // 行キー → 変更（ステージング）。空 = 変更なし
```

`makeTableTab` は `primaryKey: [], edits: {}` で初期化。

### 3.6 ストアのアクション（追加 / 変更）

```ts
setCellEdit: (tabId: string, row: Record<string, unknown>, column: string, value: string) => void
setCellNull: (tabId: string, row: Record<string, unknown>, column: string) => void
discardEdits: (tabId: string) => void
commitEdits: (tabId: string) => Promise<void>
```

- `setCellEdit` / `setCellNull`: `rowKeyOf` で行キーを求め、`edits[key]`（なければ `{ pk: 主キー値, values: {} }` で作成）の `values[column]` を更新。**新値がオリジナルと等しければ** その列の変更を削除し、`values` が空になったら行エントリごと削除（ハイライト解除）。
- `discardEdits`: `edits` を `{}` に。
- `commitEdits`: `buildUpdateStatements(tableName, primaryKey, Object.values(edits))` → `window.api.applyChanges(statements)`。成功で `edits` を空にし、現在ページを再取得（`runTable(tabId, { recount: false })`、UPDATE は件数を変えない）。失敗で `error` をタブに設定し、`edits` は保持（再試行可能）。
- `selectTable` を拡張: テーブルを開くとき `window.api.primaryKey(name)` を呼び、結果を `primaryKey` にセットしてから（または並行して）ページ取得を行う。

ナビゲーション保護: `setPage` / `setSort` / `setPageSize` / `applyFilters` は、`edits` が非空のとき `confirm('未コミットの変更があります。破棄して移動しますか？')` を表示。OK のときだけ `discardEdits` してから実行、キャンセルなら何もしない。

### 3.7 UI

#### `ResultsGrid.tsx`（変更）
- 編集可能（`tab.kind === 'table' && primaryKey.length > 0`）なテーブルのセルを編集可能にする。
- セルを `ダブルクリック` または選択中に `Enter` で編集モード（インライン `<input>`）。`Enter` で確定（`setCellEdit`）、`Esc` で取消。編集中セルは青枠＋入力欄、入力欄の右に小さな「NULL」ボタン（押すと `setCellNull` して確定）。
- 変更済みセル（`edits[rowKey]?.values` に該当列がある）は黄色ハイライトし、オリジナルではなく**変更後の値**を表示。`null` はイタリックの `NULL` 表示。
- 主キー列のヘッダに 🔑 を表示。
- SQL タブ・主キーなしテーブルは従来どおり非編集（セルクリックで何も起きない）。
- ソート可能ヘッダ（前機能）と編集は両立する。

#### `EditBar.tsx`（新規） + `EditBar.module.css`
- `tab.kind === 'table'` かつ `edits` が非空のときだけ、結果グリッドの下・Pager の上に表示。
- 表示: 「● 未コミットの変更: N 件（M 行）」＋ `破棄` ボタン ＋ `コミット ⌘S` ボタン。
- `⌘S`（Mac）/`Ctrl+S` のキーボードショートカットでコミット（編集可能テーブルにフォーカスがある間）。実行中（`tab.running`）はボタン無効。

#### `WorkspaceShell.tsx`（変更）
テーブルタブのレンダリング順: `FilterBar` → `ResultsGrid` → `EditBar`（変更がある時のみ）→ `Pager` → `StatusBar`。

### 3.8 IPC / preload / 型
- `db:primaryKey(table)` → `ApiResult<string[]>`
- `db:applyChanges(statements)` → `ApiResult<{ affectedRows: number }>`
- `src/preload/index.ts` と `src/renderer/src/env.d.ts` に対応する `primaryKey` / `applyChanges` を追加。

## 4. エラーハンドリング

- コミット失敗（制約違反・型不一致など）: トランザクション全体をロールバックし、`normalizeDbError` 経由のエラーをタブに表示。ステージは保持して再試行可能。
- 主キー検出が失敗・空: そのタブを読み取り専用（`primaryKey: []`）にフォールバック。編集 UI は無効。
- クライアント例外: 既存の `failTab` パターンで `running` 固着を防止。

## 5. テスト

- **`editBuilder` ユニット（DB 不要）**: 単一列 UPDATE / 複数列 / 複合主キー（WHERE が AND 結合）/ NULL 設定（param が null）/ 識別子のバッククォートエスケープ / WHERE は `pk`（オリジナル値）を使う / `values` 空の行はスキップ / `primaryKey` 空なら空配列。
- **`rowKey` ユニット**: 同じ主キー値→同じキー、異なる値→異なるキー、複合主キー。
- **結合テスト（docker MySQL、gated）**: `primaryKey()` が PK 列を返す（主キーなしテーブルで `[]`）。`applyChanges()` が複数 UPDATE をトランザクションで適用する。失敗を含む文を渡すと全ロールバックされる（部分適用されない）。

## 6. 既知の制約（v1 で許容）

- UNIQUE キーのみ（PK なし）のテーブルは今回は読み取り専用（将来 UNIQUE 対応の余地）。
- 編集はカレントページ単位。ページ移動・ソート・フィルタ・再取得で未コミット分は破棄（移動時に `confirm` で確認）。
- 値の入力は文字列ベース。mysql2 が列型に合わせて変換する（数値列に "42" を入れれば int に変換）。NULL は明示的に「NULL」ボタンで設定。

## 7. ファイル一覧

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/main/connection/ConnectionManager.ts` | 変更 | `primaryKey()` / `applyChanges()` 追加 |
| `src/main/ipc/registerDbHandlers.ts` | 変更 | `db:primaryKey` / `db:applyChanges` ハンドラ |
| `src/preload/index.ts` | 変更 | `primaryKey` / `applyChanges` をブリッジ |
| `src/renderer/src/env.d.ts` | 変更 | API 型を追加 |
| `src/shared/types.ts` | 変更 | `RowEdit` 等の共有型 |
| `src/renderer/src/store/editBuilder.ts` | 新規 | UPDATE 文生成（純粋） |
| `src/renderer/src/store/editBuilder.test.ts` | 新規 | editBuilder ユニット |
| `src/renderer/src/store/rowKey.ts` | 新規 | 行キー生成（純粋） |
| `src/renderer/src/store/rowKey.test.ts` | 新規 | rowKey ユニット |
| `src/renderer/src/store/useAppStore.ts` | 変更 | TableTab 拡張・編集アクション・ナビ保護 |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | セル編集 UI |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | 編集中/変更済みセルのスタイル |
| `src/renderer/src/workspace/EditBar.tsx` | 新規 | コミットバー |
| `src/renderer/src/workspace/EditBar.module.css` | 新規 | コミットバーのスタイル |
| `src/renderer/src/workspace/WorkspaceShell.tsx` | 変更 | EditBar 配線 |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | PK/トランザクション結合テスト |
