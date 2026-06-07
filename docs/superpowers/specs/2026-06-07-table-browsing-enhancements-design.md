# テーブルビュー閲覧体験の強化 — 設計ドキュメント

**日付**: 2026-06-07
**ステータス**: 承認済み（実装計画へ移行）

## 1. 目的

テーブルビュー（サイドバーでテーブルを選んで開くタブ）を「テーブルを快適に見る」体験として完成させる。直前に実装したフィルターバーと地続きで、以下を追加する:

1. **列ヘッダクリックによるソート**（サーバーサイド `ORDER BY`）
2. **ページサイズ可変＋ページ送り**（サーバーサイド `LIMIT` / `OFFSET`）
3. **総件数の表示**（`COUNT(*)` で「ページ N/M」「X–Y / 総件数」）

ステータスバーの「行数・実行時間」は既に実装済みのため対象外。

## 2. スコープ

- **対象**: テーブルビュー（`TableTab`）のみ。クエリをこちら側で組み立てているためサーバーサイドでの並べ替え・ページングが可能。
- **対象外**: SQL タブ（`SqlTab`）。ユーザーが手書きした SQL を勝手に書き換えない。従来どおりそのまま実行する。

## 3. アーキテクチャ

### 3.1 状態（`TableTab` に追加）

`src/renderer/src/store/useAppStore.ts` の `TableTab` インターフェースに4フィールドを追加する。

```ts
export interface TableTab extends BaseTab {
  kind: 'table'
  tableName: string
  columns: string[]
  filters: FilterCondition[]
  sort: { column: string; dir: 'asc' | 'desc' } | null // null = 自然順
  pageSize: number // 50 | 100 | 500（既定 100）
  page: number // 0 始まり（UI 表示は 1 始まり）
  total: number | null // COUNT(*) 由来。未取得は null
}
```

`makeTableTab` は `sort: null, pageSize: 100, page: 0, total: null` で初期化する。

### 3.2 クエリ組み立て（`src/renderer/src/store/filterBuilder.ts`）

WHERE 句の生成を共有ヘルパー `buildWhere` に切り出し、ページ用クエリと COUNT クエリで再利用する（DRY）。

```ts
// 既存の isUsable / clauseFor を流用して WHERE 句と params を組み立てる内部ヘルパー
function buildWhere(
  columns: string[],
  conditions: FilterCondition[]
): { where: string; params: unknown[] }
```

公開 API:

```ts
export interface PageOptions {
  sort?: { column: string; dir: 'asc' | 'desc' } | null
  limit?: number
  offset?: number
}

// ページ用 SELECT。ORDER BY / LIMIT / OFFSET を付与
export function buildFilteredQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[],
  options?: PageOptions
): { sql: string; params: unknown[] }

// 総件数用 SELECT COUNT(*) AS total。ORDER BY / LIMIT は付けない（params は WHERE と同じ）
export function buildCountQuery(
  table: string,
  columns: string[],
  conditions: FilterCondition[]
): { sql: string; params: unknown[] }
```

生成例:

```sql
-- buildFilteredQuery（sort あり / page=1 / pageSize=100）
SELECT * FROM `users` WHERE `status` = ? ORDER BY `created_at` DESC LIMIT 100 OFFSET 100

-- buildCountQuery
SELECT COUNT(*) AS total FROM `users` WHERE `status` = ?
```

#### 安全策（既存のセキュリティ境界を維持）

- **ORDER BY 列**: 既存のカラム・ホワイトリスト（`columns`）に含まれる場合のみ採用。含まれない／`sort` が null の場合は `ORDER BY` を付けない。列名は既存の `quoteIdent`（バッククォート2重化）でエスケープ。
- **ソート方向**: `'asc' | 'desc'` の固定集合。想定外は `'asc'` にフォールバック（または無視）。
- **LIMIT / OFFSET**: ユーザー自由入力ではなく、ページサイズのホワイトリストと計算済みオフセット由来。`Number.isInteger` かつ非負を確認した整数を SQL に直接埋め込む（mysql2 の prepared statement における LIMIT プレースホルダの落とし穴を回避）。`limit` 未指定時は従来どおり `LIMIT 100` 相当を既定とする。
- **フィルター値**: 従来どおり全て `?` プレースホルダ。

### 3.3 データフロー（`runTable` の拡張）

`runTable(tabId, opts: { recount: boolean })` に変更:

1. `offset = tab.page * tab.pageSize` を計算
2. `buildFilteredQuery(tableName, columns, filters, { sort, limit: pageSize, offset })` を実行
3. `opts.recount === true` のときのみ `buildCountQuery(...)` も実行し `total` を更新（結果は `Number(rows[0]?.total ?? 0)`）

COUNT を再実行するのはフィルターやテーブルが変わったときだけ。ソート・ページ送り・ページサイズ変更では件数は不変なので再実行しない。

| 操作 | アクション | page | recount |
|---|---|---|---|
| テーブルを開く | `selectTable` | 0 | ✅ |
| フィルタ適用 | `applyFilters` | 0 にリセット | ✅ |
| フィルタクリア | `clearFilters` → 再実行 | 0 にリセット | ✅ |
| ソート変更 | `setSort` | 0 にリセット | ❌ |
| 前へ / 次へ | `setPage` | ±1 | ❌ |
| ページサイズ変更 | `setPageSize` | 0 にリセット | ❌ |

- ソートはフィルタ変更をまたいで保持する（page のみリセット）。
- 新規 IPC は不要。既存の `window.api.query(sql, params)` を（recount 時のみ）2回呼ぶ。
- COUNT クエリが失敗してもページクエリが成功していれば結果は表示する（`total = null` にして劣化動作、3.4 参照）。

### 3.4 ページ計算（`src/renderer/src/store/pager.ts` 新規・純粋関数）

UI から切り離してユニットテスト可能にする。

```ts
// 総ページ数（total が null のときは null）。0 件でも最小 1 ページ扱い
export function totalPages(total: number | null, pageSize: number): number | null

// 現在ページの表示範囲。{ start, end }（0 件なら { start: 0, end: 0 }）
export function pageRange(
  page: number,
  pageSize: number,
  returned: number
): { start: number; end: number }

// 「次へ」可否。total があれば最終ページ判定、なければ「返却行数 == pageSize」で判定
export function canGoNext(
  page: number,
  pageSize: number,
  total: number | null,
  returned: number
): boolean
```

- `start = returned === 0 ? 0 : page * pageSize + 1`
- `end = page * pageSize + returned`
- `canGoNext`: `total != null` なら `page + 1 < totalPages(total, pageSize)`、`total == null` なら `returned === pageSize`
- 「前へ」可否は単純に `page > 0`（純粋関数化は不要だが Pager 内で判定）

### 3.5 UI コンポーネント

#### `ResultsGrid.tsx`（変更）
- アクティブタブが `table` のとき、列ヘッダをクリック可能にする。
- クリックで同一列のソート状態を `なし → 昇順(▲) → 降順(▼) → なし` で巡回。別の列をクリックしたらその列の昇順から開始。
- アクティブなソート列のヘッダに `▲`（asc）/ `▼`（desc）を表示。
- SQL タブのヘッダは従来どおりクリック不可。
- 実装: `ResultsGrid` がアクティブタブを参照し、`kind === 'table'` のとき内部 `Grid` に `sort` と `onSort(column)` を渡す。SQL タブでは `onSort` を渡さず（undefined）ヘッダを非クリックにする。

#### `Pager.tsx`（新規） + `Pager.module.css`
- 結果グリッドの下、ステータスバーの上に表示。**テーブルタブのときのみ**描画。
- レイアウト:
  ```
  ページサイズ [100 ▾]    ◀ 前へ   ページ 1 / 124   次へ ▶        1–100 / 12,345 行
  ```
- ページサイズ選択: `<select>` で 50 / 100 / 500。
- `◀ 前へ`: `page === 0` で無効。`次へ ▶`: `canGoNext` が false で無効。
- 実行中（`tab.running`）は前へ/次へ/サイズ変更を無効化（連打防止、フィルターバーの running ガードと同様）。
- `total === null` のときは「ページ N / ?」とし範囲のみ「X–Y 行目」表示にフォールバック。

#### `WorkspaceShell.tsx`（変更）
テーブルタブのレンダリングに `Pager` を追加:
- table: `FilterBar` → `ResultsGrid` → `Pager` → `StatusBar`
- sql: `QueryEditor` → `ResultsGrid` → `StatusBar`（Pager なし）

#### `StatusBar.tsx`（変更なし）
現状維持。「直近クエリの返却行数 · 実行 ms」を表示。総件数・ページ位置は Pager に集約。

### 3.6 ストアのアクション（追加）

```ts
setSort: (tabId: string, column: string) => Promise<void>   // 巡回ロジック + page=0 + runTable({recount:false})
setPage: (tabId: string, page: number) => Promise<void>     // page 設定 + runTable({recount:false})
setPageSize: (tabId: string, size: number) => Promise<void> // size 設定 + page=0 + runTable({recount:false})
```

`selectTable` / `applyFilters` / `clearFilters` は `runTable(tabId, { recount: true })` を呼ぶよう更新。

## 4. エラーハンドリング

- ページクエリ失敗: 従来どおり `error` をタブに設定し `running:false`（既存の `runTable` の挙動を踏襲）。
- COUNT クエリ失敗: `total = null` にして劣化動作（3.4）。ページクエリ自体は表示する。
- 例外（クエリ組み立て失敗等）: 既存の `failTab` で `running` 固着を防止。

## 5. テスト

- **`filterBuilder` ユニット（DB 不要）**:
  - `buildFilteredQuery` に `sort`/`limit`/`offset` を渡すと正しい SQL を生成
  - ORDER BY 列がホワイトリスト外なら `ORDER BY` を付けない
  - `limit`/`offset` の整数ガード（非整数・負数は採用しない）
  - `buildCountQuery` が `SELECT COUNT(*) AS total ... WHERE ...` を生成し WHERE params が一致
- **`pager.ts` ユニット**: `totalPages` / `pageRange` / `canGoNext` の境界（0 件 / 端数ページ / total null）
- **（任意）結合テスト**: `ConnectionManager.integration.test.ts` に ORDER BY + LIMIT/OFFSET が期待行を返すケースを追加（docker MySQL）

## 6. 既知の制約（v1 で許容）

- ソート列に重複値があると `OFFSET` ページングで境界がわずかにぶれる可能性（主キーのタイブレーク未対応）。主キー取得は将来の「テーブル構造ビュー」機能で対応し、その後にタイブレークを追加する余地がある。TablePlus も同様の挙動。
- `total` は COUNT(*) のため巨大テーブルでは取得に時間がかかる場合がある。フィルタ変更時のみ実行することで頻度を抑える。

## 7. ファイル一覧

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/renderer/src/store/useAppStore.ts` | 変更 | TableTab 拡張、runTable 拡張、setSort/setPage/setPageSize 追加 |
| `src/renderer/src/store/filterBuilder.ts` | 変更 | buildWhere 切り出し、buildFilteredQuery 拡張、buildCountQuery 追加 |
| `src/renderer/src/store/pager.ts` | 新規 | totalPages / pageRange / canGoNext（純粋関数） |
| `src/renderer/src/store/pager.test.ts` | 新規 | pager 純粋関数のユニットテスト |
| `src/renderer/src/store/filterBuilder.test.ts` | 新規/変更 | sort/limit/offset/count のユニットテスト |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | ソート可能ヘッダ + 指標表示 |
| `src/renderer/src/workspace/Pager.tsx` | 新規 | ページャ UI |
| `src/renderer/src/workspace/Pager.module.css` | 新規 | ページャのスタイル |
| `src/renderer/src/workspace/WorkspaceShell.tsx` | 変更 | テーブルタブで Pager を描画 |
