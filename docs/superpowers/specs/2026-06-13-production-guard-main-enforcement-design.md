# 本番ガードの main 側強制（Production Guard — Main Enforcement）設計

> 作成日: 2026-06-13 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.3.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（S1）、v0.2.0 で導入した本番ガード（PR #35）

## 1. 背景と問題

v0.2.0 で「本番環境（`production` タグ）接続ガード」を導入したが、ガードは **renderer 側にしか存在しない**。

- 接続時の確認ダイアログ: `src/renderer/src/store/useAppStore.ts:406`（`window.confirm`、接続の瞬間に1回だけ）
- 警告バー: `src/renderer/src/workspace/WorkspaceShell.tsx`（赤い「PRODUCTION」表示）
- 判定: `src/renderer/src/store/helpers.ts:27`（`isProductionProfile`）

**`ConnectionConfig`（`src/shared/types.ts:17`）に `tag` フィールドが無く、`ProfileStore.getConnectConfig()` も tag を渡さないため、main プロセスは「今 production に接続しているか」を知らない。** その結果、接続後の破壊的操作は何も守られておらず、以下がすべて本番でも無確認でバイパス可能:

1. SQLタブの任意実行（`db:query` / `db:queryScript`）— `DROP DATABASE` でも `DELETE` でも追加確認なし
2. テーブル右クリックの DROP / TRUNCATE（`db:query` 経由）
3. SQLダンプ import/restore（`menu.ts` のネイティブメニュー起動 → `sqlImport:start`）— **renderer の confirm を物理的に通らない**最大の穴
4. SQLダンプ export（`menu.ts exportSqlDump`）— 本番データ全行を無確認でファイル化
5. セル編集 / INSERT / 行削除のコミット（`db:applyChanges`）

## 2. ゴール / 非ゴール

### ゴール
- main プロセスが現在の接続の production 状態を保持し、**書き込み・破壊系の全操作の境界で main が確認を強制**する（renderer を信頼しない）。
- 確認は2段階: **通常書き込み**は OK/キャンセル、**壊滅的操作**はチェックボックス必須の強い確認。
- 確認ロジック（文の分類・接続状態）を純粋関数に切り出してユニットテストする。

### 非ゴール
- 破壊的 SQL の厳密なパース（`WHERE` 無し `DELETE` の検出など）。先頭キーワードのヒューリスティックで十分とする。
- renderer 側確認モーダルのリッチ化・接続名タイプ確認。
- 複数同時接続対応（別テーマ）。
- 本番での操作の「ハードブロック」（常に確認で続行可能とする。禁止はしない）。

## 3. スコープ（ガード対象と確認ティア）

| 操作 | 強制を仕込む場所 | ティア |
|---|---|---|
| SQLタブ実行 | `db:query` / `db:queryScript`（IPC） | 文の分類で判定（readonly はガードなし） |
| セル編集/INSERT/行削除コミット | `db:applyChanges`（IPC） | `write`（固定） |
| テーブル DROP/TRUNCATE | `db:query`（既存経路） | 文の分類で `catastrophic` |
| import/restore | `sqlImport:start`（IPC、実行直前） | `catastrophic`（固定） |
| dump export | `menu.ts exportSqlDump` | `catastrophic`（固定） |

非 production（context が null または tag≠production）の接続では、**いずれも素通り**（一切確認しない）。

## 4. 設計概要（Approach A: main 集中ガード + native ダイアログ）

```
[connections:connect(id)] --成功--> ProfileStore から {tag,name} 取得 --> productionContext.set()
                                                                              │
[db:disconnect] / 接続一覧へ戻る ----------------------------------> productionContext.clear()

書き込み/破壊系 IPC・メニュー操作:
  handler --> guardProductionAction(window, tier)
                 │  productionContext.isProduction() == false ──> true（素通り）
                 │  == true ──> confirmProductionAction(window, tier, opLabel)
                 │                  └─ dialog.showMessageBox（2段階）──> ユーザー応答
                 └─ false（キャンセル）──> handler は { ok:false, error:{ code:'CANCELLED' } } を返す
```

renderer を一切信頼しないため、改ざんやネイティブメニュー直起動でもガードは外れない。

## 5. コンポーネント詳細

### 5.1 `src/main/connection/productionContext.ts`（新規・モジュールシングルトン）

`src/main/import/importState.ts` と同じモジュールシングルトン方式（プロセス内に1つだけ存在するクロスカット状態）。

```ts
interface ProductionContextValue { tag: ConnectionTag; name: string }
let current: ProductionContextValue | null = null

export function setProductionContext(v: ProductionContextValue): void { current = v }
export function clearProductionContext(): void { current = null }
export function getProductionContext(): ProductionContextValue | null { return current }
export function isProductionConnection(): boolean { return current?.tag === 'production' }
```

判定基準は renderer の `isProductionProfile`（`tag === 'production'`）と同一にする。

### 5.2 `src/main/guard/classifyStatement.ts`（新規・純粋関数・テスト対象）

既存の `SqlStatementSplitter`（`src/main/import/sqlStatementSplitter.ts`）で入力を文単位に分割し、各文の**先頭キーワード**でティアを判定。スクリプト全体のティアは**最大ティア**（catastrophic > write > readonly）。

```ts
export type GuardTier = 'readonly' | 'write' | 'catastrophic'

const CATASTROPHIC = new Set(['DROP', 'TRUNCATE'])
const WRITE = new Set(['INSERT','UPDATE','DELETE','REPLACE','ALTER','CREATE','RENAME','GRANT','REVOKE','CALL','LOAD'])
// 上記以外（SELECT/SHOW/DESCRIBE/EXPLAIN/USE/SET …）は readonly 扱い

export function classifyStatement(sql: string): GuardTier
export function classifyScript(sql: string): GuardTier  // 分割して最大ティアを返す
```

- 先頭キーワードは前後空白・先頭 `(` を除いた最初の語を大文字化して判定。
- 既知の限界（spec に明記）: `CALL proc()` の内部削除までは追わない（`write` 扱いで確認は出る）。文字列リテラル内の `;`/キーワードは splitter の既存簡易仕様に従う。`EXPLAIN ...`（Cmd+E）は `readonly`。空入力/コメントのみは `readonly`。

### 5.3 `src/main/guard/confirmProductionAction.ts`（新規・ダイアログは注入可能）

2段階の native ダイアログを構築・表示する。ダイアログ引数の組み立ては純粋関数に分離してテストする。

```ts
// 純粋関数（テスト対象）: ティアとラベルから showMessageBox の options を組む
export function buildConfirmOptions(tier: 'write'|'catastrophic', opLabel: string, connName: string): MessageBoxOptions

// 実表示（dialog.showMessageBox を注入可能に）
export async function confirmProductionAction(
  win: BrowserWindow | null,
  tier: 'write' | 'catastrophic',
  opLabel: string,
  deps?: { showMessageBox?: typeof dialog.showMessageBox }
): Promise<boolean> // true=続行, false=中止
```

- **write**: `type:'warning'`、`buttons:['キャンセル','実行する']`、`defaultId:0`、`cancelId:0`、`message` に接続名＋操作種別。
- **catastrophic**: 上記に加え `checkboxLabel:'本番だと理解した上で実行する'`、本文を強い警告調に。**チェック未了で「実行する」が押された場合は中止扱い（false）**（チェックを強制）。
- 応答解釈: `response === 1`（実行ボタン）かつ（write なら無条件／catastrophic なら `checkboxChecked === true`）で `true`。それ以外は `false`。

### 5.4 `src/main/guard/productionGuard.ts`（新規・薄いヘルパー）

各ガードポイントの定型（production 判定 → 親ウィンドウ解決 → confirm 呼び出し）をまとめる。

```ts
// IPC ハンドラ用（e.sender から親ウィンドウを解決）
export async function guardProductionTier(e: IpcMainInvokeEvent, tier: 'write'|'catastrophic', opLabel: string): Promise<boolean>
// SQL 文字列から自動分類して判定（readonly は即 true）
export async function guardProductionSql(e: IpcMainInvokeEvent, sql: string, opLabel: string): Promise<boolean>
// メニュー用（getFocusedWindow を使用）
export async function guardProductionMenu(tier: 'write'|'catastrophic', opLabel: string): Promise<boolean>
```

いずれも `isProductionConnection() === false` なら即 `true`（素通り）。

## 6. ガードポイント統合（既存ハンドラの変更）

### 6.1 `src/main/ipc/registerConnectionHandlers.ts`
`connections:connect(id)` の成功後に context を設定:
```ts
const config = store.getConnectConfig(id)
await connectWithTunnel(manager, config, tunnel)
const meta = store.list().find((p) => p.id === id) // ConnectionProfile（tag を持つ）
if (meta) setProductionContext({ tag: meta.tag, name: meta.name })
```
（`ConnectionConfig` には tag を足さない＝テスト接続経路を汚さない。tag は `store.list()` から引く。）

### 6.2 `src/main/ipc/registerDbHandlers.ts`
- `db:connect`（テスト接続・生 config）: `clearProductionContext()` を呼ぶ（tag 不明＝非 production 扱い。書き込みは発生しない）。
- `db:query`: 実行前に `if (!(await guardProductionSql(e, sql, 'SQL 実行'))) return CANCELLED`。
- `db:queryScript`: 同上（`guardProductionSql`）。**履歴 `history.add` はキャンセル時には記録しない**。
- `db:applyChanges`: 実行前に `if (!(await guardProductionTier(e, 'write', '変更の適用'))) return CANCELLED`。
- `db:disconnect`: `clearProductionContext()` を呼ぶ。

`CANCELLED` の戻り: `{ ok: false, error: { code: 'CANCELLED', message: '' } }`。

### 6.3 `src/main/import/registerImportHandlers.ts`
`sqlImport:start` で、production 時は**ファイルを消費する前に**ガードする（キャンセル時に pending を温存し、再度のファイル選択を不要にするため）:
```ts
if (!(await guardProductionTier(e, 'catastrophic', 'SQL ダンプの import/restore'))) {
  return { ok: false, error: { code: 'CANCELLED', message: '' } }
}
const filePath = consumePendingImport()
```
既存の `consumePendingImport()` / `isImporting()` チェックとの前後関係は、guard を最初に置く前提で実装計画が最終整理する。

### 6.4 `src/main/menu.ts`
- `exportSqlDump`: `isConnected()` チェックの直後に `if (!(await guardProductionMenu('catastrophic', 'SQL ダンプのエクスポート'))) return`。
- `importSqlDump`: ファイル選択は従来どおり。実行強制は `sqlImport:start`（6.3）に置くため、メニュー側の追加確認は不要（二重を避ける）。

## 7. renderer 側の変更（CANCELLED の静かな処理）

main がキャンセルを `{ ok:false, error:{ code:'CANCELLED' } }` で返すため、renderer は**エラー表示せず静かに中止**する。`src/renderer/src/store/helpers.ts` に純粋ヘルパーを追加:

```ts
export function isCancelled(res: { ok: false; error: { code: string } }): boolean {
  return res.error.code === 'CANCELLED'
}
```

適用箇所（いずれも「エラーにせず元の状態へ戻すだけ」）:
- `runActiveTab` / SQL 実行系: CANCELLED なら `running` を false に戻すのみ（`tab.error` を設定しない）。
- `commitEdits`: CANCELLED なら**ステージング変更を保持**し `committing` を false に戻すのみ（破棄しない）。
- `truncateTable` / `dropTable`: CANCELLED なら `window.alert` を出さない。
- import（`SqlImportModal`）: `sqlImport:start` が CANCELLED を返したらモーダルを閉じる／「キャンセルしました」を出すだけでエラー扱いしない。

## 8. 既存確認との関係（二重確認の方針）

main の新ガードは production 接続時のみ作動する。既存の renderer 確認との関係:

- **接続時 confirm（useAppStore.ts:406）**: 「接続する」ことへの確認で、書き込みガードとは別物。**変更しない**（main は接続自体は確認しない）。
- **DROP/TRUNCATE の `window.confirm`（既存）**: 「どのテーブルを」消すかの意図確認。production 時は main が「本番で実行するか」の catastrophic 確認を追加 → **2段確認になるが catastrophic では意図的に許容**。
- **import の SqlImportModal（既存）**: ファイル/DB を示す意図確認。production 時は `sqlImport:start` で catastrophic 確認を追加 → 同上、許容。

非 production では従来どおり renderer の確認のみで挙動は不変。

## 9. テスト方針

純粋関数・状態モジュールを厚くテストする（CI に MySQL 不要）。

- `classifyStatement` / `classifyScript`: readonly/write/catastrophic の代表ケース、複数文の最大ティア、先頭 `(`・空白・大小文字、`EXPLAIN`、空/コメントのみ。
- `productionContext`: set/get/clear、`isProductionConnection` の tag 判定（production / staging / none / null）。
- `buildConfirmOptions`: write と catastrophic でボタン構成・`defaultId/cancelId`・`checkboxLabel` の有無を検証。
- `confirmProductionAction`: `showMessageBox` を注入し、(a) write で実行ボタン→true、(b) catastrophic でチェック無し実行→false、(c) チェック有り実行→true、(d) キャンセル→false。
- `isCancelled`（renderer helpers）: CANCELLED 判定。
- 既存テスト（`useAppStore.connect.test.ts` ほか）が壊れないこと。

## 10. 受け入れ基準

1. production 接続中に SQLタブで `DELETE`/`UPDATE`/`DROP`/`TRUNCATE` 等を実行すると、実行前に main の確認が出る（`DROP`/`TRUNCATE` はチェックボックス必須）。`SELECT` では出ない。
2. production 接続中のセル編集/INSERT/行削除コミットで OK/キャンセル確認が出る。キャンセルでステージングは保持される。
3. production 接続中に File メニューの dump export / import を実行すると、チェックボックス必須の確認が出る。**renderer を経由しない import 起動でもガードが外れない。**
4. いずれの確認もキャンセル時にエラートーストが出ず、操作前の状態に戻る。
5. 非 production 接続（staging/development/local/none）では、上記いずれの追加確認も出ず、v0.2.0 と同じ挙動。
6. `npm run typecheck` と `npm test` が PASS。新規純粋関数のユニットテストが追加されている。

## 11. 影響を受けるファイル

**新規:**
- `src/main/connection/productionContext.ts`
- `src/main/guard/classifyStatement.ts` + `classifyStatement.test.ts`
- `src/main/guard/confirmProductionAction.ts` + `confirmProductionAction.test.ts`
- `src/main/guard/productionGuard.ts`
- `src/main/connection/productionContext.test.ts`

**変更:**
- `src/main/ipc/registerConnectionHandlers.ts`（connect 成功時に context 設定）
- `src/main/ipc/registerDbHandlers.ts`（query/queryScript/applyChanges/connect/disconnect にガード）
- `src/main/import/registerImportHandlers.ts`（sqlImport:start にガード）
- `src/main/menu.ts`（exportSqlDump にガード）
- `src/renderer/src/store/helpers.ts`（`isCancelled` 追加）+ `helpers.test.ts`
- `src/renderer/src/store/useAppStore.ts`（SQL 実行/commitEdits/truncate/drop の CANCELLED 分岐）
- `src/renderer/src/workspace/SqlImportModal.tsx`（CANCELLED の静かな処理）

## 12. 未確定事項（実装計画で確定する）
- `sqlImport:start` 内での guard・`consumePendingImport()`・`isImporting()` チェックの最終的な並び順（方針は §6.3 の通り guard を先頭に置く）。
- `opLabel`（ダイアログ本文の操作名）の最終文言と、ダイアログ本文に DB 名・接続名をどこまで含めるか。
