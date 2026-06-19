# SQLタブ 自動LIMIT ＋ 結果上限ガード（P2）設計

> 作成日: 2026-06-19 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.4.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（P2）/ `memory: v0-4-scope` / 対になる P1（行仮想化）

## 1. 背景と問題

SQLタブ（`db:queryScript` → `ConnectionManager.runScript`）は、ユーザーが書いたSQLを **LIMIT を一切付けずにそのまま実行**する（調査で確認）。`SELECT * FROM huge_table` のような素のクエリを流すと、全行が main プロセスのメモリへ展開され、IPC で renderer に丸ごと転送され、`ResultsGrid` が全行を DOM 描画してフリーズし得る（観測 9903 に「auto-LIMIT が無く大結果でフリーズ」と記録）。

対照的に **テーブル閲覧**（`db:query` → `buildFilteredQuery`）は既に自動 LIMIT 100 ＋ OFFSET ページング ＋ `COUNT(*)` が完備している。SQLタブだけが無防備。

現状（調査で確認、すべて絶対パスは `src/` 起点）:
- `ConnectionManager.runScript`（`src/main/connection/ConnectionManager.ts:104-114`）が `SqlStatementSplitter` で `;` 分割し全文逐次実行、**最後の文の結果のみ**返す。`runOne`（同 39-53）が `[rows, fields]` を `QueryResult` に整形。LIMIT 付与・SELECT 判定・行数制限は無い。
- `runOne` は SQLタブ（`runScript`）・テーブル閲覧（`query`）・**CSVエクスポートの全件取得（`limit:null`）**で共有される。
- IPC（`src/main/ipc/registerDbHandlers.ts`）: `db:queryScript` は `guardProductionSql` を通し `history.add` してから結果を返す。**行数・転送サイズの上限ガードは無い**。
- renderer（`src/renderer/src/store/useAppStore.ts:247-276` `runSql`）が `window.api.queryScript(tabId, sql)` を呼ぶ。`ResultsGrid.tsx` が結果と「実行中…」＋停止ボタン（U1）を表示。
- 既存の大量データ確認パターン: CSVエクスポートの `EXPORT_CONFIRM_THRESHOLD = 50000`（`useAppStore.ts:955`）のみ。
- 先頭キーワード分類 `classifyStatement.leadingKeyword`（`src/main/guard/classifyStatement.ts:16-34`）が SELECT 判定の足場として流用可能。
- 設定画面は存在しない（定数は各所ハードコード）。

## 2. ゴール / 非ゴール

### ゴール
- SQLタブで素の `SELECT` を流してもフリーズしない**多層防御**を入れる:
  - **ソフト自動LIMIT**: 単一の素 SELECT に既定 `LIMIT 500` を自動付与（利便性＋第一防御、上書き可）。
  - **ハード上限ガード**: 自動LIMITを回避されたケースの最終防御として、結果を `10000` 行で打ち切る。
- 自動LIMIT適用・打ち切りを **UI で明示**し、ユーザーが上書きできる手段を提供する。
- U1（クエリキャンセル）の `runCancellable` / `KILL QUERY` 機構と素直に共存する。

### 非ゴール
- ストリーミングによる main プロセスのメモリ保護（採用アプローチ B の真の防御）。バイパス時に main へ一瞬全行が載る点は既知の限界として §7 に記載。将来切り出し。
- 行の仮想スクロール（P1。本設計と対になる別タスク）。
- テーブル閲覧（`db:query`）・CSVエクスポート（`limit:null`）経路の変更。**両者は不変**。
- 自動LIMIT値・上限値のユーザー設定UI（設定画面が無いため定数で固定）。
- `SHOW` / `DESCRIBE` / DML / DDL への自動LIMIT付与。

## 3. 設計

### 3.1 全体方針

処理は **SQLタブ経路（`db:queryScript` → `runScript`）に閉じる**。

採用アプローチ = **A（main側でSQL加工 ＋ 取得後slice）**。理由: v0.4 の「素SELECTでフリーズさせない」目的に対し最小改修で多層防御を達成し、U1のキャンセル機構（`runCancellable`/`runOne`）と素直に共存する。

> 採用しなかった代替案: (B) SQLタブ経路を `streamRows` ベースに載せ替え N+1 行目で stop → main メモリも保護できるが、`runCancellable` の threadId 捕捉・複数文・キャンセル統合が複雑化し v0.4 スコープに対し過大。(C) renderer 側で SQL 加工 → パースが `explain.ts` と重複し、本番ガード・履歴が main にあるのに判定だけ renderer になり不自然。

⚠️ **ハード上限の slice は共有 `runOne` には置かない**。`runOne` は CSVエクスポートの全件取得（`limit:null`）でも使われ、ここで切ると全件エクスポートが 10000 行に化ける。**ハード上限は `runScript`（SQLタブ専用）の結果に対してのみ適用**する。

### 3.2 共有定数（新規 `src/shared/queryLimits.ts`）

```ts
export const DEFAULT_SQL_LIMIT = 500   // ソフト自動LIMIT
export const MAX_RESULT_ROWS = 10000   // ハード上限
```

main・renderer 双方から import（renderer は注記文言の生成に使用）。設定画面が無い現状に合わせ、まずは定数で固定し将来の設定UIに備える。

### 3.3 自動LIMIT判定モジュール（新規 `src/main/connection/autoLimit.ts`）

純関数 `maybeApplyAutoLimit(sql: string, statementCount: number): { sql: string; applied: boolean }`。

**自動LIMITを付与する条件（すべて満たす場合のみ）:**
1. **単一文**である（`statementCount === 1`。`SqlStatementSplitter` の分割結果が1文）。
2. 先頭キーワードが **`SELECT`**、または **`WITH … SELECT`**（CTE）。
3. **トップレベルに `LIMIT` が無い**（括弧深度0で `LIMIT` トークンが出現しない）。
4. （呼び出し側で `skipAutoLimit` が false）。

上記以外（複数文・`SHOW`/`DESCRIBE`/`INSERT`/`UPDATE`/`DELETE` 等・トップレベルLIMIT有り・判定不能）は**すべてスキップ**し、`{ sql: 原文, applied: false }` を返してハード上限ガードに委ねる。

**実装方針:**
- `runScript` に渡る各文は `SqlStatementSplitter` によりコメント除去・末尾セミコロン無しのクリーンなSQL。
- 先頭キーワード: `classifyStatement.leadingKeyword` を流用。`WITH` の場合は「先頭が WITH かつ後続に SELECT を含む」で SELECT 系と判定。
- トップレベル `LIMIT` 検出: 文字列リテラル・バッククォート識別子・括弧深度を考慮したトークンスキャンで **深度0の `LIMIT`** を検出。サブクエリ内 `LIMIT`（深度>0）は無視。
- 付与は末尾へ ` LIMIT 500` を連結（`ORDER BY` の後でも文法上正しい）。
- **判定は絶対に例外を投げず、SQLを壊さない**。少しでも曖昧なら原文をそのまま返す（保守的フォールバック）。

### 3.4 ConnectionManager（`src/main/connection/ConnectionManager.ts`）

- `queryScript` / `runScript` のシグネチャに `opts?: { skipAutoLimit?: boolean }` を追加。
- `runScript` のフロー:
  1. `SqlStatementSplitter` で分割 → 文配列と `statementCount` を得る。
  2. `statementCount === 1 && !skipAutoLimit` のとき `maybeApplyAutoLimit(stmt, 1)` を呼び、`applied` を `autoLimited` として記録。
  3. 各文を従来どおり `runCancellable`/`runOne` で逐次実行（最後の文の結果を採用）。
  4. 最終結果に対し `rows.length > MAX_RESULT_ROWS` なら `rows = rows.slice(0, MAX_RESULT_ROWS)`、`truncated = true`、`rowCount` は slice 後の件数。
  5. `QueryResult` に `autoLimited` / `truncated` を載せて返す。

### 3.5 QueryResult 型（`src/shared/types.ts`）

```ts
export interface QueryResult {
  columns: ColumnMeta[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  autoLimited?: boolean   // ソフト LIMIT 500 を自動付与した
  truncated?: boolean     // ハード上限 10000 で打ち切った
}
```

`autoLimited`(500) と `truncated`(10000) は 500<10000 のため実際は排他だが、フィールドは独立。

### 3.6 IPC / preload / store

- IPC `db:queryScript`（`registerDbHandlers.ts`）: 引数に `skipAutoLimit` を追加し `manager.queryScript(sql, tabId, { skipAutoLimit })` へ渡す。**本番ガード・履歴は自動LIMIT付与の前段**で動くため、`history.add` にはユーザーが書いた**原文SQL**が残る（`LIMIT 500` 入りではない）。
- preload（`src/preload/index.ts`）: `queryScript: (tabId, sql, skipAutoLimit?) => ipcRenderer.invoke('db:queryScript', tabId, sql, skipAutoLimit)`。
- store（`useAppStore.ts` `runSql`）: `runSql(tabId, sql, opts?: { skipAutoLimit?: boolean })`。`skipAutoLimit` を `window.api.queryScript` に渡し、結果の `autoLimited`/`truncated` をタブに格納。

### 3.7 renderer UI（`ResultsGrid.tsx` 結果ヘッダ）

- `result.autoLimited` 時: 「先頭500件を表示中（自動LIMIT）」＋ **「自動LIMITを外して再実行」ボタン** → `runSql(tab.id, tab.sql, { skipAutoLimit: true })`。再実行もハード上限10000まで効く。
- `result.truncated` 時: 「結果が大きいため先頭10000件で打ち切り。全件はCSVエクスポートを使用してください」（ボタンなし＝再実行しても無意味なため）。
- 文言中の件数は `DEFAULT_SQL_LIMIT` / `MAX_RESULT_ROWS` 定数から生成。

## 4. データフロー

```
Cmd+Enter → runActiveTab → runSql(tabId, sql, {skipAutoLimit:false})
  → window.api.queryScript(tabId, sql, skipAutoLimit)
  → IPC db:queryScript → guardProductionSql → history.add(原文SQL)
  → manager.queryScript(sql, tabId, {skipAutoLimit})
  → runScript: 分割 → [単一適格 && !skip] なら末尾に LIMIT 500 (autoLimited=true)
  → runCancellable/runOne 実行 → rows>10000 なら slice (truncated=true)
  → QueryResult{..., autoLimited, truncated}
  → store → ResultsGrid が注記表示

[再実行ボタン] → runSql(tabId, sql, {skipAutoLimit:true})
  → 同経路・LIMIT付与なし → ハード上限のみ効く → 注記更新
```

## 5. エラー処理・エッジケース

- 自動LIMIT判定は例外を投げず、曖昧なら原文返し（保守的フォールバック）。
- `SELECT … LIMIT 5, 10`（オフセット形式）/ `LIMIT 10 OFFSET 5` → トップレベルLIMIT有り → スキップ。
- `WITH cte AS (... LIMIT 5) SELECT ...` → CTE内LIMITのみ・トップレベル無し → 付与。
- `SELECT * FROM (SELECT ... LIMIT 5) x` → サブクエリLIMITのみ → 付与。
- ハード上限 slice は純配列操作で例外なし。
- **キャンセル時**（U1）: 結果が返らないため注記ロジックは成功時のみ動作。既存 `isCancelled` 無音停止と干渉しない。

## 6. テスト戦略（TDD）

`*.test.ts` コロケート、`vitest` 実行。

### ユニット（実DB不要）
- **`autoLimit.test.ts`**: 素SELECT→付与 / 小文字→付与 / `LIMIT 10`・`LIMIT 5,10`・`LIMIT 10 OFFSET 5`→付与せず / サブクエリLIMITのみ→付与 / `WITH…SELECT`→付与 / `SHOW`・`DESCRIBE`・`INSERT`・`UPDATE`→付与せず / 複数文→付与せず / `skipAutoLimit`→付与せず / 不正SQL→原文・例外なし。
- **`ConnectionManager.queryScript.test.ts`**（pool モック流用）: 10001行→10000行＋`truncated` / 500行→そのまま / 単一素SELECT→query へ渡るSQLに `LIMIT 500` / 複数文→付与されない（呼び出しSQL検証）。

### 統合（実MySQL、`TEST_MYSQL_*`、`describe.skipIf`）
- `ConnectionManager.integration.test.ts` に追加: 600行テーブルで素`SELECT *`→500行＋`autoLimited` / `skipAutoLimit=true`→600行・`autoLimited`無し / 10001行＋明示`LIMIT 100000`→10000行＋`truncated`。

### renderer ストア
- `useAppStore.test.ts` に追加: `runSql` が `skipAutoLimit` を渡す / 結果の `autoLimited`/`truncated` がタブに格納 / 再実行アクションが `skipAutoLimit=true` で再呼び出し。

### リグレッション
- テーブル閲覧（`query`）・CSVエクスポート（`limit:null`）経路が不変であること（既存テスト緑のまま）。

## 7. 既知の限界

- **main メモリ保護は不完全**: ハード上限の slice は取得後に行うため、自動LIMITを回避したバイパスクエリ（明示の巨大LIMIT・UNION・複数文等）では main プロセスへ一瞬全行が展開される。ソフト自動LIMITが常用ケースを抑えるため実害は限定的。真のメモリ保護はストリーミング（アプローチB）が必要で、将来切り出し。
- 自動LIMIT・上限値は定数固定（設定UIは将来）。
- 自動LIMITは**単一の素SELECTのみ**が対象。複数文や複雑なクエリはハード上限ガードのみが効く（意図的な保守設計）。
