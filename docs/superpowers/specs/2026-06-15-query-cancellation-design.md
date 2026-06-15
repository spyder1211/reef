# クエリキャンセル（U1）設計

> 作成日: 2026-06-15 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.4.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（U1, §3）/ `memory: v0-4-scope`

## 1. 背景と問題

Table++ には**実行中クエリを中断する手段が無い**（監査で確認済み）。重いクエリ（`SELECT * FROM huge`・重いフィルタ/ソート/`COUNT(*)`）を流すと、そのタブが完了まで固着し、接続を切る以外に止められない。DB クライアントとして致命的な欠落。

現状（調査で確認）:
- `ConnectionManager`（`src/main/connection/ConnectionManager.ts`）は単一 `mysql.Pool`（`connectionLimit: 5`）。
- `query(sql, params)`（行28-39）/ `queryScript(sql)`（行46-58）は `pool.query()` のバッファモードで実行し、**実行中の接続スレッドIDを知らない**ため `KILL QUERY` を送れない。
- `withDedicatedConnection<T>(fn)`（行200-216）= プールから1本専有して callback を実行し、正常時 `release()` / 異常時 `destroy()` する既存パターンが import 用に存在する（本設計はこれを踏襲）。
- IPC（`src/main/ipc/registerDbHandlers.ts`）: `db:query` / `db:queryScript` は `guardProductionSql` を通り `ApiResult<QueryResult>` を返す。`CANCELLED = { ok:false, error:{ code:'CANCELLED', message:'' } }`（行23-24）は**実行前**の本番ガードキャンセル専用。
- renderer（`src/renderer/src/store/useAppStore.ts`）: `runSql`（行237-263）/ `runTable`（行265-299）が `tab.running` を立て、`helpers.ts` の `isCancelled()`（行35-37）で CANCELLED を静かに処理。`ResultsGrid.tsx:46` が `tab.running` 時に「実行中…」を表示。**停止ボタンは存在しない**。

## 2. ゴール / 非ゴール

### ゴール
- 実行中クエリを、別接続からの `KILL QUERY` で中断できるようにする。
- 対象は **SQL タブ実行（`db:queryScript`）とテーブル閲覧クエリ（`db:query`：フィルタ/ソート/ページング/COUNT）の両方**。
- 中断は既存の CANCELLED 経路に合流させ、**エラー表示なしで静かに停止**する。
- 実行中表示の横に「停止」ボタンを出す。

### 非ゴール
- クエリの自動タイムアウト（監査 P5・`MAX_EXECUTION_TIME`）。本設計は手動停止のみ。
- import / 編集コミット（`applyChanges`）のキャンセル。
- pool の全接続が固着した場合の堅牢化（§6 の既知の制限として文書化のみ）。
- 複数接続対応（F1）。本設計は単一 pool 前提。

## 3. 設計

### 3.1 全体方針

実行中クエリを **pool から専有した1接続**で走らせ、その MySQL スレッドID（`conn.threadId`）を `tabId` をキーに登録する。停止時は**別の pool 接続**から `KILL QUERY <threadId>` を送る。`KILL QUERY` は接続を生かしたまま現在の文だけ中断するため、中断後の接続は `release()` でプールへ綺麗に返せる（`KILL CONNECTION` や `destroy()` は使わない）。

中断された文は mysql2 が `ER_QUERY_INTERRUPTED`（errno 1317）で reject する。これを `QueryCancelledError` に変換し、IPC ハンドラが既存の `CANCELLED` 定数を返す。renderer は既存の `isCancelled()` でそのまま静かに停止する。

> 採用しなかった代替案: (a) `connection.destroy()` で接続ごと切断 → 接続が壊れ pool から destroy 必須・再接続コスト大。(b) `MAX_EXECUTION_TIME` 自動タイムアウト → 手動停止にならず P5 の領域。

### 3.2 main / ConnectionManager（`src/main/connection/ConnectionManager.ts`）

- フィールド追加: `private runningQueries = new Map<string, number>()`（tabId → threadId）。
- `query` / `queryScript` のシグネチャに任意の `tabId?: string` を追加し、`tabId` がある場合のみ**専用接続方式で実行＋登録**（キャンセル対象）する。`tabId` 無し（スキーマ取得など内部クエリ）は従来どおり `pool.query()` で実行する（登録なし・キャンセル対象外）。

`tabId` ありのときに使う内部ヘルパー `runCancellable`（呼び出し側は必ず `tabId` を渡す）:
```ts
private async runCancellable<T>(
  tabId: string,
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  if (!this.pool) throw new Error('未接続です')
  const conn = await this.pool.getConnection()
  const threadId = conn.threadId            // mysql2 PoolConnection が公開
  this.runningQueries.set(tabId, threadId)
  try {
    return await fn(conn)
  } catch (err) {
    if (isQueryInterrupted(err)) throw new QueryCancelledError()
    throw err
  } finally {
    this.runningQueries.delete(tabId)
    conn.release()                          // KILL QUERY は接続を殺さないので release で良い
  }
}
```
> 実装注: `conn.threadId` が undefined の環境に備え、フォールバックとして `SELECT CONNECTION_ID()` を1回実行して取得する分岐を実装側で用意してよい（設計上は `conn.threadId` を第一手段とする）。`isQueryInterrupted(err)` は `err && (err.code === 'ER_QUERY_INTERRUPTED' || err.errno === 1317)`。

- `query(sql, params, tabId?)`: `tabId` ありなら `runCancellable(tabId, conn => conn.query(sql, params))`、無しなら既存の `pool.query(sql, params)`。いずれも結果を既存の `QueryResult` 形へ整形する共通処理に通す。
- `queryScript(sql, tabId?)`: `tabId` ありなら `runCancellable(tabId, async conn => { 分割した各文を for ループで conn.query。中断 reject が起きたら catch は runCancellable 側に伝播しループは自然終了（残り文は実行しない） })`、無しなら既存のプール経由ループ。
- `cancel(tabId)`: 
```ts
async cancel(tabId: string): Promise<void> {
  const threadId = this.runningQueries.get(tabId)
  if (threadId == null || !this.pool) return        // 既に完了/未実行なら no-op
  await this.pool.query('KILL QUERY ?', [threadId])  // 別接続で送信
}
```
- 新規 export: `class QueryCancelledError extends Error`（main 内部用）。

### 3.3 main / IPC（`src/main/ipc/registerDbHandlers.ts`）

- `db:query` ハンドラ: `(e, tabId, sql, params)` を受け、`manager.query(sql, params, tabId)` を呼ぶ。`QueryCancelledError` を catch したら `CANCELLED` を返す。
- `db:queryScript` ハンドラ: `(e, tabId, sql)` を受け、`manager.queryScript(sql, tabId)`。`QueryCancelledError` 時は `CANCELLED` を返し、**履歴には追加しない**（成功/失敗のみ記録）。
- 新規 `db:cancel` ハンドラ: `(e, tabId) => { await manager.cancel(tabId); return { ok: true } }`。**`guardProductionSql` は通さない**（自分のクエリの停止は破壊的でない）。
- `CANCELLED` 定数は既存のものを再利用。

### 3.4 preload（`src/preload/index.ts`）と型

- `query(tabId, sql, params)` / `queryScript(tabId, sql)` に `tabId` を**第1引数**で追加（IPC 引数順と一致させる）。
- 新規 `cancelQuery(tabId): Promise<ApiResult<void>>` → `ipcRenderer.invoke('db:cancel', tabId)`。
- `src/renderer/src/env.d.ts` の `Window.api` 型を追従（`query`/`queryScript` の引数追加 + `cancelQuery`）。

### 3.5 renderer / store（`src/renderer/src/store/useAppStore.ts`）

- `runSql(tabId, sql)`: `window.api.queryScript(tabId, sql)` に変更（tabId を渡す）。CANCELLED 処理は既存どおり。
- `runTable(tabId, opts)`: `window.api.query(tabId, sql, params)` に変更し、**`isCancelled(res)` の分岐を追加**（CANCELLED 時は running を戻すのみ・エラー表示なし）。
- `BaseTab` に `canceling: boolean` を追加（初期 false）。新規アクション:
```ts
async function cancelTab(tabId: string): Promise<void> {
  set({ tabs: get().tabs.map(t => t.id === tabId ? { ...t, canceling: true } : t) })
  await window.api.cancelQuery(tabId)
  // running の解除は、停止された query/queryScript が CANCELLED で解決した時に行われる
}
```
running が false に戻るタイミング（CANCELLED 受信時）で `canceling` も false に戻す。

### 3.6 renderer / UI（`src/renderer/src/workspace/ResultsGrid.tsx`）

- `tab.running` 時の「実行中…」表示の横に「停止」ボタンを追加。`tab.canceling` 中はボタンを disable し「停止中…」に切替。クリックで `cancelTab(tab.id)`。
- 既存の placeholder CSS に停止ボタンのスタイルを追加（`ResultsGrid` のスタイルモジュール）。

## 4. データフロー（停止シナリオ）

1. renderer `runSql(tabId)` → `api.queryScript(tabId, sql)`。
2. main `db:queryScript` → `guardProductionSql` → `manager.queryScript(sql, tabId)`。
3. manager: `pool.getConnection()` → `threadId = conn.threadId` → `runningQueries.set(tabId, threadId)` → 文を実行。
4. ユーザーが「停止」→ `cancelTab(tabId)` → `api.cancelQuery(tabId)` → `db:cancel` → `manager.cancel(tabId)` → 別接続で `KILL QUERY <threadId>`。
5. 実行中の文が errno 1317 で reject → `QueryCancelledError` → `finally` で `runningQueries.delete` + `conn.release()`。
6. ハンドラが `CANCELLED` を返す → renderer `isCancelled()` → `running=false, canceling=false`、エラー表示なし。

## 5. テスト

統合テスト（`ConnectionManager.integration.test.ts`、CI で常時実行されるようになった）に追加:
- **キャンセル成功**: `manager.query('SELECT SLEEP(5)', [], 'tab-1')` を待たずに、別途 `manager.cancel('tab-1')` を呼ぶ。元の呼び出しが **~2 秒以内**に `QueryCancelledError`（または query 経由で reject）で終わること、かつ経過時間が 5 秒未満であることを検証。
- **接続の生存**: キャンセル後に同 manager で `query('SELECT 1', [], 'tab-2')` が正常に返る（KILL QUERY が接続を殺していない＝pool が健全）。
- **未実行時 no-op**: 実行中でない `tabId` に `cancel` しても reject せず何も起きない。

ユニットテスト:
- `runningQueries` の register/delete（モック接続で `runCancellable` の finally が必ず delete する）。
- `isQueryInterrupted` の判定（code/errno 両方）。

## 6. リスクと既知の制限

- **pool 枯渇**: `connectionLimit: 5` のすべてが固着クエリで埋まると、`cancel` の `KILL QUERY` 送信用接続が取得できずブロックし得る。現実の同時実行は低い（UI は概ねタブごとに1クエリ）ため許容し、本設計では**文書化のみ**（堅牢化は別途）。
- **threadId 取得**: 第一手段 `conn.threadId`。環境差で undefined の場合は `SELECT CONNECTION_ID()` フォールバック（§3.2 実装注）。
- **KILL 権限**: 自分のスレッドの `KILL QUERY` は通常権限で可能（他人のスレッドは要 `PROCESS` 権限だが、ここでは常に自分のスレッド）。
- **レース**: クエリ完了直後の `cancel` は registry 不在で no-op（§3.2）。逆にキャンセル直後にクエリが自然完了した場合は CANCELLED でなく通常結果が返るが、`isCancelled` 不成立で結果表示されるだけで害はない。

## 7. 影響ファイル一覧

- `src/main/connection/ConnectionManager.ts` — 修正（runCancellable / query / queryScript / cancel / QueryCancelledError）
- `src/main/ipc/registerDbHandlers.ts` — 修正（tabId 受け渡し / db:cancel / CANCELLED 変換）
- `src/preload/index.ts` — 修正（query/queryScript 引数 / cancelQuery 追加）
- `src/renderer/src/env.d.ts` — 修正（Api 型追従）
- `src/renderer/src/store/useAppStore.ts` — 修正（tabId 受け渡し / runTable の isCancelled / cancelTab / canceling）
- `src/renderer/src/workspace/ResultsGrid.tsx`（+ スタイル）— 修正（停止ボタン）
- `src/main/connection/ConnectionManager.integration.test.ts` — テスト追加
- `src/main/connection/ConnectionManager.cancel.test.ts`（新規・ユニット）— register/delete・判定
