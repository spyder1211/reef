# DB の SQL ダンプ エクスポート 設計

作成日: 2026-06-08

## 背景

現状、接続中の DB 全体を SQL ファイルとして書き出す手段が無い。別環境への復元やバックアップのため、ネイティブの「ファイル」メニューから、接続中 DB の全ベーステーブルを **スキーマ＋データ** の SQL ダンプ（mysqldump 風）として保存できるようにする。

生成は外部バイナリ（`mysqldump`）に依存せず、既存の mysql2 接続を使ってアプリ内で行う。DB 全体は大きくなり得るため、テーブルごとに行をストリーミングしてファイルへ逐次書き込み、メモリ使用量を行バッチ分に抑える。

## スコープ

- 対象: **接続中の DB の全ベーステーブル**（`Table_type = 'BASE TABLE'`）。
- 内容: **スキーマ（CREATE TABLE）＋データ（INSERT）** のフルダンプ。
- 起動口: **ネイティブの「ファイル」メニュー**（現状メニュー未設定のため新設）。
- 生成: アプリ内（mysql2）。メインプロセスで完結（メニュー・接続・ファイル書き込みがいずれも main 側）。

### スコープ外（v1）
- ビュー / ストアドプロシージャ / トリガー / イベント / 関数のダンプ。
- スキーマのみ / データのみの切り替え（フルダンプ固定）。
- 圧縮（.gz）・ファイル分割・進捗バー・特定テーブルのみの選択ダンプ。
- メニュー項目の接続状態による動的 enable/disable（クリック時チェックで代替）。
- アプリ内 UI ボタンからの起動（File メニューのみ）。

## ダンプ形式（mysqldump 風・復元可能）

```sql
-- TablePlus SQL Dump
-- Database: <db名>
-- Generated: <ISO8601 日時>

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

DROP TABLE IF EXISTS `t1`;
<SHOW CREATE TABLE t1 の結果>;

INSERT INTO `t1` (`col1`, `col2`) VALUES (…),(…);
INSERT INTO `t1` (`col1`, `col2`) VALUES (…),(…);

DROP TABLE IF EXISTS `t2`;
…

SET FOREIGN_KEY_CHECKS=1;
```

- 末尾で `SET FOREIGN_KEY_CHECKS=1;` に戻す。FK チェック無効化により、テーブルの依存順に関係なく復元可能。
- データが 0 行のテーブルは DDL のみ（INSERT なし）。
- 文字コードは UTF-8（BOM なし。SQL ファイルは BOM 不要）。改行は `\n`。

### 値のエスケープ規則（`escapeSqlValue`）

JS ランタイム型で判定する（`dateStrings: true` 設定のため DATE/DATETIME/TIMESTAMP は文字列で届く）。

| 値 | 出力 |
|---|---|
| `null` / `undefined` | `NULL` |
| `number` | `String(value)`（`NaN`/`Infinity` は理論上来ないが来た場合 `NULL`） |
| `bigint` | `String(value)` |
| `boolean` | `1` / `0` |
| `Buffer`（BLOB/BINARY） | 空 Buffer は `''`、それ以外は `0x` + 16進 |
| `string` ほか | シングルクォート囲み＋エスケープ |

文字列エスケープは MySQL 標準: `\0`→`\\0`、`\b`→`\\b`、`\t`→`\\t`、`\n`→`\\n`、`\r`→`\\r`、`\x1a`(Ctrl-Z)→`\\Z`、`\\`→`\\\\`、`'`→`\\'`。識別子（テーブル名・列名）はバッククォート囲みで内部のバッククォートを 2 重化。

## 設計

### 1. 純粋ヘルパー（`src/main/dump/sqlDumpHelpers.ts`・新規）

副作用のない関数群として切り出し、単体テスト可能にする。

```ts
export function escapeSqlValue(value: unknown): string
export function quoteIdent(name: string): string
export function buildDropAndCreate(table: string, createTableSql: string): string
export function buildInsert(table: string, columns: string[], rows: Record<string, unknown>[]): string
export function dumpHeader(dbName: string, generatedAt: string): string
export function dumpFooter(): string
```

- `quoteIdent`: `` `name` ``（内部のバッククォートを 2 重化）。`filterBuilder.ts` の同名ロジックと同等だが、main 側に独立して持つ（renderer の store には依存させない）。
- `buildDropAndCreate`: `` DROP TABLE IF EXISTS `t`;\n `` ＋ `createTableSql`（`SHOW CREATE TABLE` の "Create Table" 列）＋ `;\n`。
- `buildInsert`: `` INSERT INTO `t` (`c1`, `c2`) VALUES (v,…),(v,…); `` を 1 文字列で返す。`rows` が空なら空文字を返す。列順は引数 `columns` に従う。各値は `escapeSqlValue`。
- `dumpHeader`/`dumpFooter`: 上記の先頭コメント＋ `SET NAMES` / `SET FOREIGN_KEY_CHECKS` 行。`generatedAt` は呼び出し側から渡す（テスト容易性のため関数内で日時を生成しない）。

### 2. 行ストリーム取得メソッド（`src/main/connection/ConnectionManager.ts`）

ストリーミングのため、最小のメソッドを 1 つ追加する。

```ts
// プールからコネクションを 1 本取り、SELECT の行を逐次コールバックする。
// onRow が reject したら中断。完了/失敗いずれもコネクションを release する。
async streamRows(sql: string, onRow: (row: Record<string, unknown>) => Promise<void>): Promise<void>
```

- 実装は `pool.getConnection()` → `conn.connection.query(sql).stream()` の `'data'`/`'end'`/`'error'` を Promise でラップし、`'data'` ごとに `onRow` を await（バックプレッシャ）。`finally` で `conn.release()`。
- 既存メソッド（query/listTables/applyChanges 等）は変更しない。

### 3. ダンプ実行（`src/main/dump/SqlDumper.ts`・新規）

```ts
export interface DumpResult { tableCount: number; rowCount: number }
export async function dumpDatabase(
  manager: ConnectionManager,
  write: (chunk: string) => void,
  generatedAt: string
): Promise<DumpResult>
```

処理:
1. `manager.query('SELECT DATABASE() AS db')` で対象 DB 名を取得。NULL なら `throw new Error('データベースが選択されていません')`。
2. `write(dumpHeader(dbName, generatedAt))`。
3. `manager.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")` でベーステーブル名を列挙（先頭列がテーブル名）。
4. 各テーブルについて:
   - `manager.query('SHOW CREATE TABLE ' + quoteIdent(table))` → "Create Table" 列を取得し `write(buildDropAndCreate(table, createSql))`。
   - 列順を確定するため最初のバッチで `Object.keys(row)` から列を決定。`manager.streamRows('SELECT * FROM ' + quoteIdent(table), onRow)` で行を受け、**既定 200 行ごと**にバッチして `write(buildInsert(table, columns, batch))`。末尾の端数も flush。
   - `rowCount` を加算。
5. `write(dumpFooter())` し、`{ tableCount, rowCount }` を返す。

> `write` は同期コールバック（ファイル書き込みストリームの `stream.write`）。バックプレッシャは行ストリーム側の `onRow` await（`streamRows`）で十分に抑えられるため、v1 では `write` の戻り（drain）待ちは行わない。

### 4. ネイティブメニュー（`src/main/menu.ts`・新規）

```ts
export function buildAppMenu(manager: ConnectionManager): Menu
```

- `Menu.buildFromTemplate` で App / **File** / Edit / View / Window を構築。Edit（undo/redo/cut/copy/paste/selectAll ロール）と View（reload/forceReload/toggleDevTools/zoom ロール）と Window（minimize/zoom）は標準ロールで用意（メニュー新設によりコピペ等が失われないように）。
- **File → 「SQLダンプをエクスポート…」**（`click` ハンドラ、後述の `exportSqlDump` を呼ぶ）。File にはほか `close`（ウィンドウを閉じる）ロールを置く。
- macOS 以外も考慮しつつ、当面の対象は darwin。`app.name` ベースの App メニュー。

### 5. エクスポート起動ハンドラ（`src/main/dump/exportSqlDump.ts`・新規 または menu.ts 内）

```ts
async function exportSqlDump(manager: ConnectionManager): Promise<void>
```

1. `manager.isConnected()` が false → `dialog.showMessageBox`（「DB に接続していません」）で中止。
2. `dialog.showSaveDialog`（既定名 `<db名>.sql` を `SELECT DATABASE()` から、フィルタ `[{ name: 'SQL', extensions: ['sql'] }]`）。未接続時に DB 名取得が難しい場合は `dump.sql` を既定にフォールバック。
3. キャンセルなら何もしない。
4. `fs.createWriteStream(filePath, 'utf-8')` を開き、`dumpDatabase(manager, (c) => stream.write(c), new Date().toISOString())` を実行。完了後 `stream.end()` を待つ。
5. 成功 → `dialog.showMessageBox`（「ダンプを保存しました: <ファイル名>（Nテーブル / M行）」）。
6. 失敗 → ストリームを閉じ、`dialog.showMessageBox`（type:'error'、メッセージ＋「部分的に書き込まれたファイルが残っている可能性があります」）。

### 6. メニュー適用（`src/main/index.ts`）

`app.whenReady()` 内、ウィンドウ生成前後で `Menu.setApplicationMenu(buildAppMenu(manager))` を呼ぶ。`manager` は既存の `const manager = new ConnectionManager()` を共有。

## テスト

`src/main/dump/sqlDumpHelpers.test.ts`（新規）:
- `escapeSqlValue`: null/undefined→`NULL`、数値、真偽→`1/0`、Buffer→`0x…`・空 Buffer→`''`、文字列の各制御文字（`\0 \n \r \t \Z \\ '`）エスケープ。
- `quoteIdent`: バッククォート 2 重化。
- `buildInsert`: 複数行・列順・空 rows は空文字。
- `buildDropAndCreate`: DROP＋CREATE＋セミコロン。
- `dumpHeader`/`dumpFooter`: 既定文字列（`SET NAMES` / `FOREIGN_KEY_CHECKS`）。

`ConnectionManager.streamRows` / `SqlDumper` / `menu.ts` / `exportSqlDump`（DB・dialog・fs 依存）は既存方針どおり単体テスト対象外とし、純粋ヘルパーにテストを集約。typecheck と手動確認（実 DB 接続でダンプ → 別 DB に復元）で担保する。

## エラーハンドリング

- 未接続 / DB 未選択 → 案内ダイアログで中止（ダンプを開始しない）。
- 行ストリーム中の例外 → コネクション release（`streamRows` の finally）＋ 書き込みストリームを閉じ、エラーダイアログ。
- 保存ダイアログのキャンセル → 何もしない。
- `SHOW CREATE TABLE` 等の失敗 → そのテーブルで中断し全体をエラー扱い（部分ファイル残存を明記）。
