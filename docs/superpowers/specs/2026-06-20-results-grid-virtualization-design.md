# ResultsGrid 行仮想化（P1）設計

> 作成日: 2026-06-20 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.4.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（P1）/ `memory: v0-4-scope` / 対になる P2（自動LIMIT＋結果上限ガード、完了済み #45）

## 1. 背景と問題

`ResultsGrid`（`src/renderer/src/workspace/ResultsGrid.tsx`）は `@tanstack/react-table` の `getCoreRowModel` で取得した結果行を **全件 `<tr>` として DOM 描画**する（`table.getRowModel().rows.map(...)`、現状 314-421 行）。P2 でハード上限を `10000` 行に設定したため、最悪 1 万行 ×（列数）セルの DOM ノードが一度に生成され、レンダリング・スクロール・選択操作が重くなる。テーブル閲覧（`db:query`）はページング（既定 100 行）があるため軽いが、SQLタブは P2 上限まで一括描画され得る。

現状（調査で確認）:
- 実 HTML `<table>` ＋ `border-collapse`（`ResultsGrid.module.css:6-11`）。`<thead>` は `position: sticky; top: 0`（同 12-24）でヘッダ固定。
- カラム幅は `.grid { width: max-content; min-width: 100% }`（内容に応じた自動幅）、セルは `white-space: nowrap`。広い表は横スクロール。
- 行ストライプは `.grid tbody tr:nth-child(even)`（同 32-34）。
- スクロールコンテナは `.gridWrap`（`flex: 1; overflow: auto; min-height: 0`、同 1-5）。`Grid` 内で `gridWrapRef` として参照済み。
- `<tbody>` は 2 つ: ①結果行（編集/削除ステージング込み）、②INSERT 行（`inserts.map`、424-503 行）。
- 多数のインタラクションが行/セルに紐づく: 行選択（クリック/Shift/⌘、`handleRowMouseDown`）、`⌘A`/`Esc`/`ArrowUp`/`ArrowDown` キー操作（258-287 行）、セル編集（ダブルクリック→input）、右クリックメニュー（quick filter / 削除 / 複製 / コピー）、INSERT 行編集。
- 矢印キー移動は `gridWrapRef.current?.querySelector('tr[data-row-index="N"]')?.scrollIntoView(...)`（283-285 行）で可視化。
- `@tanstack/react-virtual` は **未導入**（`package.json` 確認済み。`@tanstack/react-table@^8.21.3` は導入済み）。

## 2. ゴール / 非ゴール

### ゴール
- 結果行を **可視ウィンドウ＋オーバースキャンのみ描画**する縦方向仮想化に置き換え、行数に依らず DOM ノード数を一定に保つ。
- 既存インタラクション（選択・キー操作・セル編集・右クリックメニュー・quick filter・INSERT 行・削除ステージング）を **すべて維持**する。
- ヘッダ固定・横スクロール・内容に応じたカラム幅の **見た目を維持**する。

### 非ゴール
- 横方向（列）の仮想化。列数は通常少数のため不要。
- 列リサイズ / ドラッグ並べ替え。
- 可変行高（行は単一行 `nowrap` で高さ一定の前提を維持）。
- サーバサイドページング・ストリーミング取得（main 側は無変更）。
- テーブル閲覧（`db:query`）・CSVエクスポート経路の変更。仮想化は **renderer 限定** で main・IPC・store に変更なし。

## 3. 設計

### 3.1 全体方針

`<table>` 構造（`border-collapse`・sticky `<thead>`・`<colgroup>`）を **維持**したまま、結果行 `<tbody>` を「上スペーサ `<tr>` ＋ 可視ウィンドウ行 ＋ 下スペーサ `<tr>`」に置き換える。これにより既存 CSS・ヘッダ固定・列幅機構・横スクロールがそのまま使え、多数のインタラクションへの影響を最小化する。

仮想化は `@tanstack/react-virtual` の `useVirtualizer` を使い、`.gridWrap` をスクロール要素とする。

### 3.2 カラム幅の固定（仮想化の前提）

仮想化すると可視行のみが DOM に存在するため、`width: max-content` だとスクロールのたびに幅が再計算されてガタつき、ヘッダもズレる。これを防ぐためカラム幅を **内容から実測して固定**する。

新規純関数モジュール `src/renderer/src/workspace/columnWidths.ts`:

```ts
export const ROW_HEIGHT = 25            // 単一行セルの固定行高（px）。CSS の行高と一致させる
export const MIN_COL_WIDTH = 48         // 列幅の下限（px）
export const MAX_COL_WIDTH = 480        // 列幅の上限（px）。これを超える内容はセル内で ellipsis 省略（全文は編集/コピーで取得）
const SAMPLE_ROWS = 200                 // 幅計測に使う先頭サンプル行数
const CELL_PADDING = 24                 // td の左右パディング相当の余白（px）

export function estimateColumnWidths(
  columns: { name: string }[],
  rows: Record<string, unknown>[],
  measure: (text: string) => number,
  opts?: { sampleRows?: number; minWidth?: number; maxWidth?: number; padding?: number }
): number[]
```

- 列ごとに「ヘッダ文字列」＋「先頭 `sampleRows` 行のセル文字列」を `measure` で計測し最大値を取り、`padding` を加え、`[minWidth, maxWidth]` でクランプ。
- `measure` は **注入**（ユニットテスト用にフェイク計測器を渡せる）。実行時は canvas 2D の `measureText` を、グリッドの算出フォント（ref した `th`/`td` の `getComputedStyle` から取得）で構築する。
- `null`/`undefined` は `"NULL"`、その他は `String(value)` として計測（セル表示と一致）。
- 空結果（行 0）はヘッダのみで算出。列 0 は空配列を返す。

適用: `<table>` を `table-layout: fixed` にし、`<colgroup>` の各 `<col style={{ width }}>` に実測幅を設定。テーブル全体幅は実測幅の合計（`width` に設定、`min-width: 100%`）→ 合計が広ければ従来どおり横スクロール。固定幅超過のセル内容は `overflow: hidden; text-overflow: ellipsis` で省略表示（編集中セル `.editing` のみ `overflow: visible`）。全文は従来どおりダブルクリック編集・コピーで取得可能。

再計算は `result.columns` / `result.rows`（参照）が変わったときのみ（`useMemo`）。

### 3.3 仮想化（`Grid` 内）

```ts
const rowVirtualizer = useVirtualizer({
  count: result.rows.length,
  getScrollElement: () => gridWrapRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 12
})
```

- 行は単一行（`nowrap`）で高さ一定のため **`estimateSize` は固定**（動的 `measureElement` 不要 → `scrollToIndex` が正確）。CSS で結果行 `<tr>` の高さを `ROW_HEIGHT` に固定し、JS 定数との結合をコメントで明記。
- **`@tanstack/react-table` は引き続き使用**する（列定義・ヘッダグループ・行モデル）。`const rows = table.getRowModel().rows` は全行ぶんの軽量ラッパ（DOM ではない）で、ここへ `vi.index` でインデックスして既存の `r`（`r.original`/`r.index`/`r.id`/`r.getVisibleCells()`）をそのまま使う。これにより**セル描画ロジックは無改変**で済む。
- 結果 `<tbody>` の中身:
  - 上スペーサ `<tr>`: 単一 `<td colSpan={columns.length}>`、高さ `= virtualItems[0]?.start ?? 0`。
  - 可視行: `rowVirtualizer.getVirtualItems().map((vi) => { const r = rows[vi.index]; ... })`。行レンダリングの中身（rowKey 計算・edits/deletes 反映・選択ハイライト・セル編集・右クリック）は **現状ロジックをそのまま移植**し、`r.index`（=`vi.index`）・`r.id`・`r.getVisibleCells()` を従来どおり参照。`key` は `r.id`。
  - 下スペーサ `<tr>`: 高さ `= rowVirtualizer.getTotalSize() − (virtualItems.at(-1)?.end ?? 0)`。
- INSERT 用 `<tbody>` は **非仮想化**（少数・結果行の後に全件描画、現状維持）。

### 3.4 仮想化に伴う必須の波及修正

1. **行ストライプ**: `:nth-child(even)` は窓化（可視行＋スペーサ）で破綻するため CSS ルールを撤去し、`vi.index % 2 === 1` で偶奇クラス（例 `styles.rowAlt`）を行に付与する方式へ変更。
2. **矢印キースクロール**: `scrollIntoView(querySelector('tr[data-row-index]'))`（対象行が未マウントだと無効）を、固定 `ROW_HEIGHT` とヘッダ高さからアクティブ行の content-offset を計算して `gridWrapRef.current.scrollTop` を直接補正する方式に置換。sticky `<thead>` が同一スクロールコンテナの上端を占有するため、ヘッダ高さ（`thead.offsetHeight`）分を引いて行がヘッダ下／表示下端に隠れないようにする（`virtualizer.scrollToIndex` 単体だとこのヘッダ共有分ズレるため・`scrollMargin` を入れて動作中のスペーサ計算を崩すより局所的）。描画する行は引き続き virtualizer が決める。これに伴い `data-row-index` 属性は唯一の消費者を失うため撤去。

### 3.5 既存挙動の維持で注意する点

- 編集中の行がスクロールアウトすると input がアンマウントされ、既存の `onBlur`→`confirm` 経路で編集が確定する（現行挙動どおり・許容）。`committedRef` のリセットは編集開始ごとなので二重確定は起きない。
- `⌘A` は全結果行を選択（`rowCount` ベース、DOM 非依存）→ 仮想化後も不変。
- 右クリックメニュー・quick filter・削除ステージング・複製・コピーはいずれも行データ／`r.index` ベースで、可視ウィンドウ内の行に対して発火するため変更不要。

## 4. ファイル構成

- `package.json`: `+@tanstack/react-virtual`（`devDependencies`、既存 `@tanstack/*` と並べる）。
- **新規** `src/renderer/src/workspace/columnWidths.ts`: `estimateColumnWidths` ＋ レイアウト定数（`ROW_HEIGHT`/`MIN_COL_WIDTH`/`MAX_COL_WIDTH`）。
- **新規** `src/renderer/src/workspace/columnWidths.test.ts`: エスティメータのユニットテスト。
- `src/renderer/src/workspace/ResultsGrid.tsx`: `Grid` 内に仮想化・`<colgroup>`・スペーサ・波及修正を実装。
- `src/renderer/src/workspace/ResultsGrid.module.css`: `table-layout: fixed`、結果行の固定高、`:nth-child(even)` → `.rowAlt`、スペーサ用ルール。

## 5. テスト戦略（P2 と同型）

- **ユニット** (`columnWidths.test.ts`、注入 `measure`): 
  - ヘッダのみ（空結果）で幅算出。
  - サンプル行の最大値が採られる（後方の長い行は `SAMPLE_ROWS` 超で無視されることを含む）。
  - `MIN`/`MAX` クランプ、パディング加算。
  - `null`/`undefined` が `"NULL"` 幅で計測される。
  - 列 0 → 空配列。
- **typecheck ＋ build グリーン**（renderer のみの変更）。
- **手動 GUI ゲート**（subagent では不可・最終確認）: >1000 行（理想は 10000 行）のテーブル／SQL結果で
  - 滑らかにスクロールでき、DOM ノードが一定（DevTools で確認）。
  - ヘッダが本文と整合し、スクロールで幅がガタつかない。
  - 行選択（クリック/Shift/⌘/⌘A）・矢印キー移動＋自動スクロール・セル編集（ダブルクリック）・右クリックメニュー・quick filter・INSERT 行・削除ステージング・複製・コピーが全て動作。
  - ストライプ（偶奇）が正しく、スクロールしてもちらつかない。
  - テーブル閲覧・CSVエクスポートが不変（main 無変更の確認）。

## 6. リスクと既知の限界

- **行高の前提**: 単一行（`nowrap`）固定高に依存。将来セル折返しを入れる場合は動的計測（`measureElement`）へ拡張が必要（現状スコープ外）。
- **列幅サンプリング**: 先頭 `SAMPLE_ROWS` 行のみ計測のため、`SAMPLE_ROWS` 以降に極端に長い値があると `MAX_COL_WIDTH` 未満でも見切れ得る。セルは `overflow: hidden; text-overflow: ellipsis` で省略表示（データは保持、ダブルクリック編集・コピーで全文取得可）。`MAX_COL_WIDTH` で過大幅も抑制。
- **canvas 計測の近似**: `measureText` は等幅でないフォントでも実用上十分。1〜2px のずれは `CELL_PADDING` の余白で吸収。
- **横方向は非仮想化**: 列数が極端に多い表（数百列）では `<colgroup>` と各行のセル数がボトルネックになり得るが、対象外（現実的な列数では問題なし）。
