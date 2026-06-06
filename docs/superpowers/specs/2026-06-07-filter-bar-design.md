# フィルターバー（テーブルビュー）設計書

- 作成日: 2026-06-07
- ステータス: ドラフト（設計合意済み）
- 親設計: [`2026-06-06-mysql-client-design.md`](./2026-06-06-mysql-client-design.md)（v1 全体像）
- 先行スライス: [`2026-06-06-ui-shell-native-light-design.md`](./2026-06-06-ui-shell-native-light-design.md)（Native Light シェル）

## 1. 背景（Context）

現状の Workspace は「タブ＝SQLエディタ＋結果グリッド」の1種類のみで、テーブルをクリックすると `SELECT * FROM t LIMIT 100` がエディタで走る。TablePlus のような**カラム×演算子×値のフィルターバーでテーブルを絞り込む**体験が欲しい、という要望。親設計 §4-3「カラム別 複数フィルタ」と `FilterBuilder` の最小実装にあたる。

## 2. 目的とゴール

- テーブルをクリックすると**専用のテーブルビュー**（フィルターバー＋結果グリッド、SQLエディタなし）が開く。
- フィルターバーで `[カラム][演算子][値]` の条件を複数行追加し、**AND** で結合して絞り込める。
- 生成されるクエリは**パラメータ化**して安全に実行する（SQLインジェクション防止）。

### 非ゴール（今回やらない・後続）

OR グループ化、Raw SQL 行、Any column、大文字小文字区別系、Has prefix/suffix、`NOT IN`/`NOT BETWEEN`、行ごと Apply、ソート連動、ページング（`LIMIT 100` 固定）、`FilterBuilder` のメイン側移設（§5.4 参照）。

## 3. スコープ（本スライス）

1. **2種類のタブ**: 既存の **SqlTab**（エディタ＋グリッド）に加え **TableTab**（フィルターバー＋グリッド）を導入。
2. **テーブルクリック → TableTab** を開く（同テーブルが開いていればフォーカス）。タブバーの「＋」は SqlTab。
3. **FilterBar**: 複数行の条件（有効化チェック＋カラム＋演算子＋値）、AND 結合、Apply / Clear / 行追加・削除、生成SQLの読み取り専用プレビュー。
4. **対応演算子**: `=` `<>` `<` `>` `<=` `>=` / `IS NULL` `IS NOT NULL` / `含む(LIKE)` `含まない(NOT LIKE)` / `IN` / `BETWEEN`。
5. **FilterBuilder**（純関数・TDD）: 条件 → `{ sql, params }`。カラム名はホワイトリスト照合＋バッククォート、値は `?` プレースホルダ。
6. **パラメータ化クエリ実行**: `query` を `(sql, params?)` に拡張。

## 4. タブモデル

```ts
interface BaseTab {
  id: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
}
interface SqlTab extends BaseTab {
  kind: 'sql'
  title: string
  sql: string
}
interface TableTab extends BaseTab {
  kind: 'table'
  tableName: string      // タイトルにも使う
  columns: string[]      // フィルターのカラム候補（初回 SELECT の結果メタから取得）
  filters: FilterCondition[]
}
type Tab = SqlTab | TableTab
```

- **selectTable(name)**: 既存の `TableTab`（`tableName === name`）があればフォーカス。無ければ新規 `TableTab`（`columns: []`, `filters: []`）を作って active にし、初回クエリ `SELECT * FROM \`name\` LIMIT 100` を実行 → `result` と `columns`（`result.columns.map(c => c.name)`）を設定。
- **addTab()**: 従来通り `SqlTab`（`Query N`）。
- **WorkspaceShell** はアクティブタブの `kind` で出し分け: `table` → `FilterBar` ＋ `ResultsGrid` ＋ `StatusBar`／`sql` → `QueryEditor` ＋ `ResultsGrid` ＋ `StatusBar`。
- **TabBar** はタブ種別を見分ける（テーブル＝`▦`、SQL＝`⚡`）。

## 5. フィルター

### 5.1 データモデル（shared/types.ts）

```ts
export type FilterOperator =
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | 'is_null' | 'is_not_null'
  | 'contains' | 'not_contains'
  | 'in' | 'between'

export interface FilterCondition {
  id: string
  enabled: boolean
  column: string
  operator: FilterOperator
  value: string   // 主値（between は下限 / in はカンマ区切りリスト）
  value2: string  // between の上限のみ使用
}
```

### 5.2 FilterBar（新規コンポーネント）

- 各行: `[有効チェック] [カラム▾] [演算子▾] [値入力] [−] [＋]`。
- 値入力は演算子で可変:
  - `is_null` / `is_not_null`: 値なし（入力欄を無効化）。
  - `between`: 2入力（`value`, `value2`）。
  - `in`: 1入力（カンマ区切り、プレースホルダで明示）。
  - その他: 1入力。
- フッター: `Clear`（全行削除）、`Apply`（有効行をまとめて適用＝再クエリ）。
- フッター下に**生成SQLの読み取り専用プレビュー**（`SELECT * FROM \`t\` WHERE ... LIMIT 100`、params はプレースホルダのまま）。
- 行が0件のときは「フィルターなし（全件先頭100行）」の薄い表示＋「＋ 条件を追加」。

### 5.3 FilterBuilder（純関数・TDD）

`buildFilteredQuery(table: string, columns: string[], conditions: FilterCondition[]): { sql: string; params: unknown[] }`

- 対象とする行 = `enabled` かつ `column ∈ columns` かつ「値が必要な演算子なら値が空でない」もの（それ以外はスキップ）。
- 各条件 → 句と params:

| operator | 句 | params |
|---|---|---|
| `=` `<>` `<` `>` `<=` `>=` | `` `col` OP ? `` | `[value]` |
| `is_null` | `` `col` IS NULL `` | `[]` |
| `is_not_null` | `` `col` IS NOT NULL `` | `[]` |
| `contains` | `` `col` LIKE ? `` | `['%'+value+'%']` |
| `not_contains` | `` `col` NOT LIKE ? `` | `['%'+value+'%']` |
| `in` | `` `col` IN (?, ?, …) `` | カンマ分割・trim・空除去した各要素（0件ならこの行はスキップ） |
| `between` | `` `col` BETWEEN ? AND ? `` | `[value, value2]`（どちらか空ならスキップ） |

- 識別子（table / column）はバッククォートで囲み、内部のバッククォートは2重化してエスケープ。
- `sql = "SELECT * FROM `+table+` " + (句があれば "WHERE " + 句.join(" AND ") + " ") + "LIMIT 100"`。
- 値は必ず `?` プレースホルダ＋`params`。識別子は既知カラム/テーブルのホワイトリスト由来（UI のドロップダウンは既知カラムのみ提示）。

### 5.4 安全性の所在

`FilterBuilder` はレンダラの純関数として実装し、`{ sql, params }` を生成して `window.api.query(sql, params)` で実行する。**値は常にパラメータ化**されるため注入は不可。識別子はドロップダウンが提示する既知カラム/サイドバーの既知テーブルに限られ、`column ∈ columns` でも照合する。レンダラを侵害しない限り任意SQLは差し込めない（侵害された場合は既に `window.api.query` で任意実行が可能なため攻撃面は増えない）。親設計は `FilterBuilder` をメイン側モジュールに置く構想だが、防御多重化としての移設は後続のハードニングとする。

## 6. バックエンド（パラメータ化対応）

- `ConnectionManager.query(sql: string, params?: unknown[]): Promise<QueryResult>` に拡張。内部は `pool.query(sql, params)`（`params` 未指定なら従来通り）。
- `db:query` IPC と preload `query(sql, params?)` を `params?` 受け取りに拡張（後方互換）。env.d.ts も更新。
- 既存の SqlTab 実行は params なしのまま動作。

## 7. ストア（useAppStore）

- `Tab` を共用体化（§4）。`makeSqlTab(index)` / `makeTableTab(name)`。
- アクション追加/変更:
  - `selectTable(name)`（§4 の挙動に変更）。
  - `runActiveTab()`: SqlTab は `sql`、TableTab は `buildFilteredQuery` の結果で実行（kind で分岐）。
  - フィルター操作: `addFilter(tabId)` / `removeFilter(tabId, filterId)` / `updateFilter(tabId, filterId, patch)` / `clearFilters(tabId)` / `applyFilters(tabId)`（= 構築して実行）。
- `QueryEditor` は `tab.kind !== 'sql'` のとき null を返す。`FilterBar` は `tab.kind !== 'table'` のとき null。

## 8. エラー / 空状態

- フィルター適用結果のエラーは既存の `ResultsGrid` エラー表示を流用。
- `IN`/`BETWEEN` で値不足の行は静かにスキップ（プレビューにも出さない）。全行スキップ時は素の `SELECT ... LIMIT 100`。
- TableTab を開いた直後（初回クエリ実行前）は `running`/プレースホルダ表示。

## 9. テスト戦略

- **単体（Vitest, TDD）**: `buildFilteredQuery` —
  - 各演算子が正しい句と params を生成する。
  - 無効行・空値行・未知カラムをスキップする。
  - 複数行が AND 結合される。
  - `in` のカンマ分割（空要素除去）、`between` の値不足スキップ。
  - 識別子のバッククォート2重化エスケープ。
- 必要なら store のタブ判別ロジックの純ヘルパーを単体テスト。
- 実アプリ（`npm run dev`）で目視: テーブルクリック→絞り込み→Apply→グリッド更新、SqlTab との共存、タブ切替。

## 10. 実装フェーズ（計画フェーズで詳細化）

1. shared 型（`FilterOperator` / `FilterCondition`）＋ `query` パラメータ化（ConnectionManager / IPC / preload / env.d.ts）。
2. `FilterBuilder`（TDD）。
3. ストアのタブ共用体化＋フィルター/テーブルタブのアクション。
4. `FilterBar` コンポーネント、`TabBar`/`WorkspaceShell`/`QueryEditor` のタブ種別対応。
5. 配線・目視確認。

## 11. 未決事項 / 確認したい点

- 生成SQLプレビューは読み取り専用の小表示で開始（コピー導線などは後続）。
- `IN` はカンマ区切りテキストで開始（チップ入力などは後続）。
