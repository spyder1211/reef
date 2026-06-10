# SQL dump import / restore 設計

- Issue: #11
- 日付: 2026-06-09
- 対象: MySQL（v1）。PostgreSQL は構造を拡張しやすく保つが本スコープ外。

## 背景 / 目的

現状は DB 全体の SQL ダンプ「エクスポート」（File メニュー、PR #8）に対応済みだが、
ダンプを取り込んで「リストア」する導線がない。バックアップ復元・環境複製・検証 DB 作成のため、
GUI から `.sql` ファイルを選択して実行できる import / restore 機能を提供する。

## 確定した設計判断

ブレインストーミングで以下を確定した。

| 論点 | 決定 |
| --- | --- |
| UI 方式 | **renderer モーダル主体**。File メニュー起動 → renderer が確認/進捗/ログ/summary を駆動 |
| 実行モデル | **statement 逐次・最初のエラーで停止**（stop-on-error） |
| 対象 DB | **接続中の DB へのみ**（v1）。新規 DB 作成は将来拡張 |
| SQL パーサ | **自前の軽量 splitter**（文字列/コメント/エスケープ考慮）。mysqldump 完全互換は非スコープ |
| トランザクション | **包まない**。MySQL の DDL は暗黙コミットで全体ロールバック不可能なため、見かけの保証で誤解を招くのを避ける |

## 全体フロー

```
File メニュー「SQLダンプをインポート / リストア…」
  └ main: 接続チェック → ネイティブ file picker(.sql) → 選択パスを main 側 state に保持
      └ renderer に app:sql-import-request 送信 { fileName, totalBytes, dbName }
          └ renderer: 確認モーダル
              （接続名/DB名 明示・危険操作 DROP/CREATE/INSERT の警告・ファイル名/サイズ表示）
              └ [実行] → api.sqlImport.start()  ※パスは渡さない（main 保持分を実行）
                  └ main: 専用接続1本で createReadStream(utf8) → splitter → 1文ずつ逐次実行
                      └ app:sql-import-progress を throttle して push
                          └ renderer: ライブ進捗 + ログ → 最終 summary 表示
```

ファイル本体は main の fs ストリームで読み、renderer にはパスを渡さず進捗イベントのみ送る
（= renderer に全量を載せない、受け入れ条件を満たす）。

## コンポーネント設計

### main 側

**`src/main/import/sqlStatementSplitter.ts`（純粋・インクリメンタル）**
- チャンク文字列を `push(chunk)` すると、それまでに完成した statement の配列を返すトークナイザ。
- 認識する構文:
  - シングルクォート文字列 `'...'`（`\` エスケープ、`''` 連続クォート）
  - ダブルクォート文字列 `"..."`
  - バッククォート識別子 `` `...` ``
  - 行コメント `-- `（および `#` 始まり）
  - ブロックコメント `/* ... */`
  - これらの内部の `;` は statement 区切りとして扱わない
- 先頭の BOM（`﻿`）を除去。CRLF を許容。
- `end()` で残りバッファ（末尾セミコロンなしの最終文や空白のみ）を flush。空白/コメントのみの文は捨てる。
- **品質の核。テストを最も厚くする。**

**`src/main/import/SqlImporter.ts`**
- `importSqlDump(manager, filePath, onProgress): Promise<ImportSummary>`
- `createReadStream(filePath, { encoding: 'utf-8' })` で逐次読み → splitter に push → 得られた各 statement を
  同一の専用接続で逐次実行。
- 進捗（`executedCount` / `bytesRead` / `totalBytes` / 直近 statement の先頭）を throttle して `onProgress` に通知
  （目安: 150ms 経過 ごと、もしくは一定 statement 数ごと）。
- stop-on-error: statement 実行が throw したら、`statementIndex`（1始まり）・`statementPreview`（先頭 N 文字）・
  DB エラーメッセージを抱えて `status: 'failed'` の summary を返す（throw しない）。
- ファイルが開けない等の致命的エラーは throw し、呼び出し側（IPC）が `ApiResult.ok:false` に変換。

**`ConnectionManager.withDedicatedConnection(fn)` を追加**
- `fn: (exec: (sql: string) => Promise<void>) => Promise<T>` に、pool から借りた1本の接続で動く `exec` を渡す。
- 終了後 release、異常時 destroy（既存 `streamRows` / `applyChanges` と同じ契約）。
- **必須理由**: dump 先頭の `SET FOREIGN_KEY_CHECKS=0` / `SET NAMES utf8mb4` は接続単位のセッション設定。
  `pool.query` の都度借りでは後続 INSERT が別接続に振られ、FK 無効化が効かず restore が失敗し得る。
  全 statement を必ず同一接続で流す。

### IPC / 型（`src/shared/types.ts`）

```ts
export interface ImportSummary {
  status: 'completed' | 'failed'
  executedCount: number          // 成功実行できた statement 数
  durationMs: number
  failure?: {
    statementIndex: number       // 1始まり：失敗した statement の番号
    statementPreview: string     // 該当 statement の先頭 N 文字
    message: string              // DB エラーメッセージ
  }
}

export interface ImportProgress {
  executedCount: number
  bytesRead: number
  totalBytes: number
  currentPreview?: string        // 実行中/直近 statement の先頭
}

export interface SqlImportRequest {
  fileName: string
  totalBytes: number
  dbName: string
}
```

- statement 実行失敗は `ApiResult.ok:true` + `status:'failed'`（実行フローには到達した）。
  ファイル/接続レベルの致命的失敗は `ApiResult.ok:false`。これにより「どの段階で失敗したか」を構造化できる。

**preload（`window.api.sqlImport`）**
```ts
sqlImport: {
  onRequest(cb: (req: SqlImportRequest) => void): () => void  // File メニューからの開始要求
  start(): Promise<ApiResult<ImportSummary>>                  // パスは受けない（main 保持分を実行）
  onProgress(cb: (p: ImportProgress) => void): () => void
}
```

**IPC ハンドラ / メニュー連携**
- `start` ハンドラを新設（`registerImportHandlers(manager)` を追加、または既存 `registerFileHandlers` に同居）。
- `menu.ts`: File に「SQLダンプをインポート / リストア…」を追加。クリックで
  接続チェック → `dialog.showOpenDialog`（`.sql`）→ 選択パスを main の module state（`pendingImportPath`）に保持 →
  フォーカス中ウィンドウへ `app:sql-import-request` を送信。
- `start()` は `pendingImportPath` を消費して実行。renderer から任意パスを注入させない（セキュリティ）。
- 多重起動ガード: import 実行中フラグを main に持ち、実行中の再要求は無視 or 警告。

### renderer 側

**`src/renderer/src/workspace/SqlImportModal.tsx`**
- 状態機械: `confirm`（確認）→ `running`（進捗バー + ログ）→ `done`（summary）/ `failed`。
- `confirm`: 接続名・DB 名・ファイル名・サイズを表示。「DROP/CREATE/INSERT を含む可能性があり、
  既存データを上書きします。DDL は途中失敗時にロールバックされません」という危険操作の警告を明示。[実行]/[キャンセル]。
- `running`: `bytesRead/totalBytes` のバー、`executedCount`、直近 statement プレビュー。
- `done`/`failed`: `ImportSummary` を表示。failed は `statementIndex` / `statementPreview` / `message` と
  「ここまでに N 文が適用済み」を表示。
- `WorkspaceShell`（または `App`）が `api.sqlImport.onRequest` / `onProgress` を購読し、モーダルの開閉と進捗を仲介。
  既存の `onReturnToConnections` 購読パターンに倣う。

## テスト戦略（TDD）

- `sqlStatementSplitter.test.ts`（厚め）:
  文字列内 `;`、シングル/ダブル/バッククォート、`\` エスケープ、`''` 連続クォート、
  行コメント `-- ` / `#`、ブロックコメント `/* */`、CRLF、末尾セミコロンなしの最終文、
  空文/空白のみ、BOM 先頭、複数行 INSERT、チャンク境界がトークン途中に来るケース。
- `SqlImporter.test.ts`:
  フェイク `withDedicatedConnection` を注入し、(1) 全文成功で `status:'completed'` と `executedCount`、
  (2) 途中で exec が throw → `status:'failed'` で `statementIndex` 正確・以降を実行しない、
  (3) `onProgress` が呼ばれることを検証。

## 受け入れ条件への対応

| 受け入れ条件 | 対応 |
| --- | --- |
| GUI からファイル選択して restore 開始 | File メニュー → file picker → 確認モーダル → 実行 |
| 危険操作の確認が出る | 確認モーダルに接続/DB 明示 + DROP/CREATE/INSERT 警告 |
| 成功時に summary 表示 | `status:'completed'` + `executedCount` / `durationMs` |
| 失敗時にどの段階で失敗したか | `failure.statementIndex` / `statementPreview` / `message` + 適用済み数 |
| renderer に全量を載せない | main の fs ストリーム読み。renderer へはパスを渡さず進捗イベントのみ |

## 非スコープ

- PostgreSQL の import 実行（executor を分離しやすい構造のみ用意）。
- 新規 DB 作成を伴う restore。
- `DELIMITER` 構文（ストアドプロシージャ等）。将来余地のみ残す。
- SQL エディタ高度化、dump ファイルの GUI 編集、mysqldump / pg_dump 完全互換の保証。
