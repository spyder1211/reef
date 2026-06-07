# レコード詳細ペイン（右ペイン編集）— 設計ドキュメント

**日付**: 2026-06-07
**ステータス**: 承認済み（実装計画へ移行）
**ベースブランチ**: `feat/cell-editing`（セル編集 UPDATE の上に積む）

## 1. 目的

TablePlus のように、グリッドで行を選択すると右ペインにそのレコードの全フィールドを縦並びで表示し、ペイン上で直接編集できるようにする。編集はセル編集機能（UPDATE）と同じステージング／一括コミット基盤を共有する。

## 2. スコープ

- **対象**: テーブルビュー（`TableTab`）。SQL タブは対象外（今回はペインを出さない。将来読み取り専用で拡張余地）。
- 行を**シングルクリックで選択** → 右ペインに全フィールドを縦並び表示。**ダブルクリック**は従来どおりセルのインライン編集。
- ペインの編集は**既存の `edits` ステージングを共有**（黄色ハイライト＋下部 EditBar に合算、`⌘S` で一括コミット）。**主キーなしテーブルはペイン表示のみ（読み取り専用）**。
- このフィーチャーは `feat/cell-editing`（PR #3）から分岐して実装する。セル編集の基盤（`edits` / `setCellEdit` / `setCellNull` / `commitEdits` / `primaryKey` / `applyChanges` / EditBar / `rowKeyOf`）をそのまま再利用する。

## 3. アーキテクチャ

### 3.1 列の型情報（mysql2 → QueryColumn.type）

`src/shared/types.ts` の `QueryColumn` を拡張:

```ts
export interface QueryColumn {
  name: string
  type?: string // mysql2 のフィールド型名（例: longlong / var_string / timestamp）。未取得は undefined
}
```

`src/main/connection/mysqlTypes.ts`（新規・純粋関数）に型コード→名前の変換を置く:

```ts
// mysql2 のフィールド型コードを表示用の型名に変換する。未知コードは `type<code>`。
export function fieldTypeName(code: number): string
```

代表的なマッピング（`mysql2/lib/constants/types` 準拠の小文字名）:
`0→decimal, 1→tiny, 2→short, 3→long, 4→float, 5→double, 6→null, 7→timestamp, 8→longlong, 9→int24, 10→date, 11→time, 12→datetime, 13→year, 15→varchar, 16→bit, 245→json, 246→newdecimal, 247→enum, 248→set, 249→tiny_blob, 250→medium_blob, 251→long_blob, 252→blob, 253→var_string, 254→string, 255→geometry`。表に無いコードは `type${code}`。

`ConnectionManager.query` で `fields` の各要素の `type`（数値コード）を `fieldTypeName` で名前化し、`columns` に含める:

```ts
const columns = (fields ?? []).map((f) => {
  const ff = f as { name: string; type?: number }
  return { name: ff.name, type: typeof ff.type === 'number' ? fieldTypeName(ff.type) : undefined }
})
```

追加クエリは不要。全 SELECT（SQL タブ含む）で型が付与される。

### 3.2 選択モデル（TableTab.selectedRowIndex）

`src/renderer/src/store/useAppStore.ts` の `TableTab` に追加:

```ts
selectedRowIndex: number | null // 現在ページ内で選択中の行インデックス。null = 未選択
```

`makeTableTab` は `selectedRowIndex: null` で初期化。

- **インデックス管理**にする（主キーなしテーブルでも一意に選択できる）。
- `selectRow(tabId, index)` で設定。
- ページ送り／ソート／フィルタ適用では行集合が変わるため `selectedRowIndex: null` にリセットする（`edits` クリアと同じ箇所）。
- **コミット後の再取得（`runTable(recount:false)`）では選択を維持**（同一ページ・同一順、UPDATE は行数・順序を変えない）。`commitEdits` は `selectedRowIndex` を触らない。
- 範囲外（`selectedRowIndex >= rows.length`）や `null` のときペインはプレースホルダを表示。

### 3.3 ペインの表示切り替え（アプリ状態）

`AppState` に追加:

```ts
detailOpen: boolean // 詳細ペインの表示状態（既定 true）
toggleDetail: () => void
```

初期値 `detailOpen: true`。`StatusBar` 右端の「▦ 詳細」ボタンで切り替え。ペインヘッダの `✕` でも閉じる（`toggleDetail` か `setDetailOpen(false)`）。本設計では `toggleDetail`（トグル）に統一し、`✕` もトグルを呼ぶ（開いている状態でのみ表示されるため実質クローズ）。

### 3.4 レイアウト

`WorkspaceShell` を3カラム構成にする:

```
[Sidebar] [mainCol（TabBar / FilterBar|QueryEditor / ResultsGrid / EditBar / Pager / StatusBar）] [DetailPane]
```

`DetailPane` は `shell` の3番目の flex 子要素（全高、幅約300px、`border-left`）。`detailOpen === true && activeKind === 'table'` のときのみ描画。

### 3.5 UI コンポーネント

#### `DetailPane.tsx`（新規） + `DetailPane.module.css`
アクティブなテーブルタブを参照し、`selectedRowIndex` / `result` / `primaryKey` / `edits` / 列型を読む。

- ヘッダ: 「レコード詳細」＋ `✕`（`toggleDetail`）。
- 本体: 未選択（`selectedRowIndex == null` または範囲外）なら「行を選択してください」。
- 選択時、`result.columns` を順に各フィールドを描画:
  - フィールド名（左）＋ 型 `column.type`（右・muted）。
  - 値: `rowKeyOf(primaryKey, row)` で `edits` を引き、該当列があれば**編集後値**（黄色ハイライト）、なければ `row[col]`。`null` は空欄＋「NULL」表示。
  - 入力コントロール: 文字列長 > 40 のときは `<textarea>`（折り返し）、それ以外は `<input>`。**ライブ束縛**で `onChange` → `setCellEdit(tab.id, row, col, e.target.value)`（ドラフト状態を持たない）。
  - 各フィールドに「NULL に設定」ボタン → `setCellNull(tab.id, row, col)`。
  - **`editable = primaryKey.length > 0` が false のときは入力を `disabled`（表示専用）**、「NULL に設定」も非表示。
- `row` は `result.rows[selectedRowIndex]`。

#### `ResultsGrid.tsx`（変更）
- 行（`<tr>`）の `onClick` で `selectRow(tab.id, r.index)`（テーブルタブのみ）。`r.index` は `result.rows` のインデックス。
- 選択行（`r.index === tab.selectedRowIndex`）は**薄い青背景**のハイライト。**変更済みセルの黄色ハイライトはセル単位で優先**（行の選択背景より上に出す）。
- ダブルクリックのセル編集（既存）と併存。セル `onDoubleClick` の `stopPropagation` は不要（クリックで選択 → ダブルクリックで編集の順で問題ない）。

#### `StatusBar.tsx`（変更） + css
- 右側に「▦ 詳細」トグルボタンを追加（`toggleDetail`）。`detailOpen` の状態でアクティブ表示。

#### `WorkspaceShell.tsx`（変更）
- `DetailPane` を3番目のカラムとして配置。`detailOpen && activeKind === 'table'` のときのみ。

### 3.6 ストアのアクション（追加 / 変更）

```ts
selectRow: (tabId: string, index: number) => void
toggleDetail: () => void
```

- `selectRow`: `patchTableTab` で `selectedRowIndex: index`。
- `toggleDetail`: `set({ detailOpen: !get().detailOpen })`。
- `applyFilters` / `setSort` / `setPage` / `setPageSize`: 既存のパッチに `selectedRowIndex: null` を追加。
- `commitEdits` / `selectTable` は `selectedRowIndex` を触らない（コミット後は選択維持、新規テーブルは初期 null）。

## 4. エラーハンドリング

- 編集・コミットは既存経路（`setCellEdit` / `setCellNull` / `commitEdits` / `applyChanges`、失敗時 `editError` を EditBar に表示）をそのまま使用。ペイン固有のエラー状態は追加しない。
- `selectedRowIndex` が範囲外・null のときはペインがプレースホルダを表示して安全に縮退。

## 5. テスト

- **`mysqlTypes` ユニット（DB 不要）**: 代表的な型コード→名前（8→`longlong`, 253→`var_string`, 7→`timestamp`, 3→`long`, 12→`datetime` 等）、未知コード→`type<code>` のフォールバック。
- **結合テスト（docker、gated）**: `query('SELECT ...')` の `columns` に型名が入ること（INT 列→`long`、VARCHAR 列→`var_string`、TIMESTAMP 列→`timestamp`）。
- ペイン／選択は UI（既存コンポーネント同様ユニットテストは持たず、`npm run typecheck` ＋ `npm run build` で担保）。

## 6. 既知の制約（v1 で許容）

- SQL タブはペイン対象外（将来、読み取り専用で拡張余地）。
- 選択は単一行・カレントページ内（ページ移動・ソート・フィルタで解除）。
- 値入力は文字列ベース（mysql2 が列型に変換）。NULL は「NULL に設定」ボタンで明示。

## 7. ファイル一覧

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/shared/types.ts` | 変更 | `QueryColumn.type?` を追加 |
| `src/main/connection/mysqlTypes.ts` | 新規 | 型コード→名前（純粋） |
| `src/main/connection/mysqlTypes.test.ts` | 新規 | mysqlTypes ユニット |
| `src/main/connection/ConnectionManager.ts` | 変更 | query で列型を付与 |
| `src/main/connection/ConnectionManager.integration.test.ts` | 変更 | 列型の結合テスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | selectedRowIndex / detailOpen / selectRow / toggleDetail / ナビでリセット |
| `src/renderer/src/workspace/DetailPane.tsx` | 新規 | 詳細ペイン |
| `src/renderer/src/workspace/DetailPane.module.css` | 新規 | ペインのスタイル |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | 行選択＋ハイライト |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | 選択行のスタイル |
| `src/renderer/src/workspace/StatusBar.tsx` | 変更 | 詳細トグル |
| `src/renderer/src/workspace/StatusBar.module.css` | 変更 | トグルのスタイル |
| `src/renderer/src/workspace/WorkspaceShell.tsx` | 変更 | 3カラム配線 |
