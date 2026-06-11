# レコード複数選択 + 右クリックバルク操作 設計

- 日付: 2026-06-11
- 対象: テーブルのレコード一覧（`ResultsGrid`）
- 目的: レコード一覧で複数行を選択し、右クリックメニューから「削除 / 複製 / クリップボードにコピー」をまとめて実行できるようにする。

## 背景・前提

既存実装の要点（調査結果）:

- レコードグリッドは `src/renderer/src/workspace/ResultsGrid.tsx`。行選択は**単一選択のみ**（`TableTab.selectedRowIndex: number | null`）。
- 削除は「**ステージング → ⌘S でコミット**」方式。`stageDelete` が `deletes`（行キー → 主キー値）にトグルで積み、コミット時に `buildDeleteStatements` が DELETE 文を生成、`applyChanges` が1トランザクションで実行。
- INSERT も同じくステージング方式。`addInsertRow` / `updateInsertCell` が `inserts: PendingInsert[]` を積み、`buildInsertStatements` が INSERT 文を生成。**値が空文字の列は SQL から除外され DB デフォルト（AUTO_INCREMENT 等）に委ねる**。
- 複合主キー対応・行キー生成（`rowKeyOf` / `pkValuesOf`）・複数文トランザクション実行の基盤は完備。
- セル単位のコンテキストメニューは実装済み（クイックフィルタ＋単一「行を削除」）。共通コンポーネントは無く各所インライン実装。
- `QueryColumn` は `name` / `type` のみで **auto_increment フラグを持たない**。`ConnectionManager.primaryKey()` も列名のみ返す。

## 確定した要件（ユーザー合意済み）

1. メニュー項目: **選択行を削除 / 選択行を複製 / クリップボードにコピー**。
2. 複製の主キー扱い: **AUTO_INCREMENT 列は除外して自動採番**。非 auto / 複合主キーは値をコピー。
3. 実行方式: **既存と同じステージング → ⌘S コミット**方式（即時実行しない）。
4. 選択操作: クリック=単一 / Shift+クリック=範囲 / ⌘(Ctrl)+クリック=個別トグル / ⌘A=全選択 / Esc=解除（標準的な macOS/TablePlus 挙動）。
5. コピー形式: **TSV（タブ区切り・ヘッダなし）**。

## 設計判断

### ① 選択状態はストア管理（採用）

`TableTab.selectedRowIndex: number | null` を以下に置き換える:

```ts
selectedRowIndices: number[]      // 選択中の行インデックス（統一インデックス空間）
selectionAnchor: number | null    // Shift 範囲選択の起点
```

理由: 既存の「ページ/フィルタ/ソート/ページサイズ変更・コミット時に選択をリセット」するロジック（約12ヶ所の `selectedRowIndex: null`）がそのまま `selectedRowIndices: []` / `selectionAnchor: null` に拡張でき、選択もタブ状態という既存設計と一貫する。

代替案（不採用）: 選択を `ResultsGrid` のローカル `useState` で持つ。ストア改変は少ないが、タブ切替・ページ変更時のリセット配線が別途必要になり既存方針から外れる。

### ② 複製の主キー除外は auto_increment 検出で判定（採用）

テーブルを開くときに auto_increment 列を取得し `TableTab.autoIncrementColumns: string[]` に保持。複製はこの列**だけ**を除外し、それ以外（非 auto / 複合主キー含む）は値をコピーする。

理由: ユーザー選択（「AUTO_INCREMENT は除外・複合/非 auto PK は値コピー」）に忠実で、自然キー・複合キーのテーブルでも正しく複製できる。

代替案（不採用）: メタデータ無しで**全主キー列**を除外。単一 `id`(AUTO_INCREMENT) の一般ケースは正しいが、自然キー/複合キーだと複製行の PK が空になりコミット時に DB エラーとなる。

## コンポーネント設計

### 1. 複数選択（`ResultsGrid.tsx` + ストア）

- **対象は結果行（メイン tbody）のみ**。INSERT 行（緑の新規行）は従来どおり単一の「この新規行を破棄」メニューのみで、バルク操作の対象外。
- 選択インデックスは既存の統一インデックス空間（結果行 `0..R-1`、INSERT 行 `R..R+I-1`）を踏襲。バルク操作は `index < R`（結果行）のみを対象に絞る。
- 操作ハンドラ（コンポーネント側で修飾キーから次の選択集合を計算）:
  - プレーンクリック: `indices=[i]`, `anchor=i`
  - ⌘/Ctrl+クリック: `i` を選択集合にトグル, `anchor=i`
  - Shift+クリック: `anchor..i`（anchor 未設定なら `0..i`）の範囲, `anchor` は維持
  - ⌘A: 全結果行 `[0..R-1]`, `anchor=0`（グリッドにフォーカスがある時のみ・`preventDefault`）
  - Esc: `indices=[]`, `anchor=null`
- ⌘A / Esc は `gridWrap` に `tabIndex={0}` を付け、グリッドにフォーカスがある時の `keydown` でのみ処理（グローバルショートカットの乗っ取りを避ける）。⌘S コミットは別所のグローバル処理なので非干渉。
- ハイライトは既存 `.selected` を選択集合の各行に適用（CSS 追加はほぼ不要）。

ストア:
- `setSelectedRows(tabId, indices: number[], anchor: number | null)` を1本追加。
- 既存 `selectRow(tabId, index)` は削除し、呼び出し箇所を `setSelectedRows(tabId, [index], index)` に置き換える。

### 2. コンテキストメニュー（バルク対応）

- 右クリック時の選択挙動:
  - クリック行が**現在の選択に含まれる** → 選択を維持（複数選択のままバルク操作）。
  - 含まれない → その1行だけに選択を畳んでから開く（標準的な挙動）。
- メニュー構成（上から）:
  1. クイックフィルタ項目（**クリックしたセル単位**・既存のまま）: `=` / `≠` / `含む`、または NULL セルなら `IS NULL` / `IS NOT NULL`。
  2. 区切り。
  3. バルク項目（`N` = 選択中の結果行数）:
     - `選択 N 行を削除`（全選択行が既に削除ステージ済みなら `削除を取り消す` に切替＝既存トグルのバルク化）
     - `選択 N 行を複製`
     - `選択 N 行をコピー`
- 既存の単一「行を削除」はこのバルク項目に統合（`N=1` でも同じ経路）。

### 3. 削除（既存機構の再利用）

- ストアに `stageDeleteMany(tabId, entries: { rowKey: string; pkValues: Record<string, unknown> }[])` を追加。
  - 全 `entries` が既に `deletes` にあるなら全解除、そうでなければ全削除ステージ（トグルの一貫性を維持）。
  - 既存 `stageDelete` 同様、削除ステージした行の `edits` は破棄（DELETE 後の UPDATE は無意味）。
- ⌘S で既存の `buildDeleteStatements` → `applyChanges` 経路に乗る（新規の SQL 生成は不要）。

### 4. 複製（INSERT ステージングに乗せる）

- ストアに `duplicateRows(tabId, rowIndices: number[])` を追加。
  - 各対象行（`result.rows[index]`）から `autoIncrementColumns` を除いた列値で `PendingInsert` を生成し `inserts` に追加。
  - 値の変換: `null` → `null`、それ以外 → `String(value)`（`PendingInsert.values` 型 `Record<string, string | null>` に合わせる。`dateStrings: true` で日時も文字列）。
  - 緑の新規行として表示され、⌘S で既存の `buildInsertStatements` → `applyChanges` 経路でコミット。
- **既知の制約**: 値が空文字 `''` の列は既存 `buildInsertStatements` 仕様で SQL から除外され DB デフォルトになる（手動 INSERT と同じ挙動）。実害は限定的なため許容。

### 5. コピー（クリップボード）

- `src/renderer/src/lib/csv.ts` に `toTsv(columns: string[], rows: Record<string, unknown>[]): string` を追加。
  - タブ区切り・**ヘッダなし**・行区切り CRLF。
  - 値に**タブ / CR / LF / ダブルクォート**を含む場合は CSV と同じクォート規則（`"` で囲み内部の `"` を `""` に2重化）。`null`/`undefined` は空文字。
- コンポーネント側で選択結果行から TSV を生成し `navigator.clipboard.writeText` で書き込み。純関数 `toTsv` は単体テスト可能。

### 6. メタデータ取得（auto_increment）

- `src/main/connection/ConnectionManager.ts` に `autoIncrementColumns(table: string): Promise<string[]>` を追加。
  - `SHOW COLUMNS FROM \`table\`` の各行で `Extra` に `auto_increment` を含む `Field` を返す（接続中 DB スコープ）。
- IPC ハンドラ（`registerDbHandlers.ts`）と preload (`api.autoIncrementColumns(table)`) に公開。
- テーブルを開く際、`primaryKey` 取得と同じ箇所で取得して `TableTab.autoIncrementColumns` に保存。

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `src/renderer/src/store/useAppStore.ts` | `TableTab` 型に `selectedRowIndices` / `selectionAnchor` / `autoIncrementColumns` 追加（`selectedRowIndex` 置換）。`makeTableTab` 初期値。リセット箇所（約12）を新フィールドへ。`setSelectedRows` / `stageDeleteMany` / `duplicateRows` 追加。テーブルオープン時に auto_increment 取得。 |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 複数選択（修飾キー処理・⌘A/Esc）、選択ハイライトを集合対応、コンテキストメニューにバルク項目（削除/複製/コピー）追加。 |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 必要なら微調整（基本は既存 `.selected` 流用）。 |
| `src/renderer/src/lib/csv.ts` | `toTsv` 追加。 |
| `src/renderer/src/lib/csv.test.ts` | `toTsv` のテスト追加。 |
| `src/main/connection/ConnectionManager.ts` | `autoIncrementColumns` 追加。 |
| `src/main/ipc/registerDbHandlers.ts` | `db:autoIncrementColumns` ハンドラ追加。 |
| `src/preload/index.ts` | `api.autoIncrementColumns` 公開。 |
| `src/renderer/src/env.d.ts` | 型公開。 |

## テスト方針

- 純関数: `toTsv`（区切り・クォート・null・空入力）。`editBuilder` は既存のまま流用（複製は INSERT 経路、削除は DELETE 経路）。
- ストアアクション: `setSelectedRows`（範囲/トグル/全選択/解除）、`stageDeleteMany`（全削除/全解除トグル）、`duplicateRows`（auto_increment 除外・null/値変換・inserts 追加）のロジック単体テスト。
- 型チェック・ビルド・既存テストスイートの通過。

## スコープ外（YAGNI）

- INSERT 行（未保存の新規行）に対するバルク操作。従来どおり単一の破棄メニューのみ。
- 列選択 / 矩形選択。今回は行単位のみ。
- コピーのヘッダ付与・CSV 形式切替（TSV ヘッダなし固定）。
- ドラッグによる範囲選択（クリック + 修飾キーのみ）。
