# レコード一覧の CSV エクスポート 設計

作成日: 2026-06-08

## 背景

テーブルビューはページング（`LIMIT`/`OFFSET`）で現在ページ分のみを `tab.result` に読み込んで表示する。ユーザーが画面に表示中のレコード一覧をそのまま CSV として取り出す手段が無い。本変更で、テーブルタブの結果を CSV としてファイル保存／クリップボードコピーできるようにする。

## スコープ

- 対象は **テーブルタブ**（左ペインのテーブルを開いた画面）のみ。
- **SQL クエリタブは対象外**（任意 SQL のため「フィルタに一致する全件」という概念が成立しない）。必要なら後続で「現在の結果のみ」を追加可能とし、本 v1 には含めない。

### 範囲（scope）と受け渡し（target）

エクスポートは 2 軸の組み合わせで、メニューから 4 通りを選べる。

| 範囲 scope | 内容 |
|---|---|
| `page` | 現在表示中のページ・現在のソート順。既読み込みの `tab.result` をそのまま使う（追加クエリなし） |
| `all` | 現在のフィルタに一致する全件。`LIMIT` を外して再取得（ソートは反映） |

| 受け渡し target | 内容 |
|---|---|
| `file` | ネイティブ保存ダイアログ → ファイル書き込み（**UTF-8 BOM 付き**） |
| `clipboard` | クリップボードへコピー（**BOM なし**） |

## CSV フォーマット

- 1 行目はヘッダ（列名）。列順は表示中のグリッドと同じ（`SELECT *` の列順）。
- 値の文字列化はグリッド表示と一致させる:
  - `null` / `undefined` → **空文字（空セル）**。
  - それ以外 → `String(value)`（グリッドのセル描画と同じ）。
- エスケープは RFC 4180 準拠: 値に `"` `,` `\r` `\n` のいずれかを含む場合、フィールド全体を `"` で囲み、内部の `"` を `""` に 2 重化する。ヘッダ（列名）にも同じエスケープを適用する。
- 行区切りは **CRLF**（`\r\n`）。末尾の余分な改行は付けない。
- **BOM は CSV 文字列には含めない**。ファイル保存時にのみメインプロセス側で `﻿`（BOM）を先頭に付与する（Excel 対応はファイル層の責務に集約。クリップボードには BOM を載せない）。

## 設計

### 1. 純粋な CSV 変換（`src/renderer/src/lib/csv.ts`・新規）

副作用のない変換関数として切り出し、単体テスト可能にする。

```ts
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string
```

- ヘッダ行 + 各データ行を CRLF で連結して返す。
- セル値: `null`/`undefined` は空文字、それ以外は `String(value)` にしたうえで上記エスケープを適用。
- BOM は付けない（純粋な CSV テキストのみ）。

### 2. ファイル保存 IPC（`src/main/ipc/registerFileHandlers.ts`・新規）

```ts
export function registerFileHandlers(): void
```

- `file:saveCsv` ハンドラを登録。引数 `(defaultFileName: string, content: string)`。
- `dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? undefined, { defaultPath: defaultFileName, filters: [{ name: 'CSV', extensions: ['csv'] }] })`。
- キャンセル時は `{ ok: true, data: { canceled: true } }` を返す。
- 確定時は `fs.writeFile(filePath, '\uFEFF' + content, 'utf-8')`（**ここで BOM を付与**）→ `{ ok: true, data: { canceled: false, filePath } }`。
- 例外は `{ ok: false, error: { code, message } }` に正規化して返す（IPC は例外を投げず判別共用体で返す既存方針に合わせる）。
- `src/main/index.ts` の `app.whenReady()` 内で `registerFileHandlers()` を呼ぶ。

### 3. 共有型（`src/shared/types.ts`）

```ts
export interface SaveFileResult {
  canceled: boolean
  filePath?: string
}
```

### 4. preload（`src/preload/index.ts`）

```ts
saveCsv: (defaultFileName: string, content: string): Promise<ApiResult<SaveFileResult>> =>
  ipcRenderer.invoke('file:saveCsv', defaultFileName, content)
```

`Api` 型は `typeof api` から自動導出されるため追加作業は不要。

### 5. 「全件」取得のための `filterBuilder` 拡張（`src/renderer/src/store/filterBuilder.ts`）

`PageOptions.limit` に `null` を許可し、`null` のとき `LIMIT` 句を出力しない（`OFFSET` も付けない）。既定（`undefined`）は従来どおり `LIMIT 100`。

```ts
export interface PageOptions {
  sort?: TableSort | null
  limit?: number | null   // null = LIMIT なし（全件）
  offset?: number
}
```

`buildFilteredQuery` 内で `options?.limit === null` のとき `LIMIT`/`OFFSET` を組み立てないよう分岐する。既存の `safeInt` による非負整数ガードは `number` 指定時のまま維持。

### 6. ストアアクション（`src/renderer/src/store/useAppStore.ts`）

```ts
exportCsv: (
  tabId: string,
  opts: { scope: 'page' | 'all'; target: 'file' | 'clipboard' }
) => Promise<ExportCsvResult>
```

戻り値型（UI のフィードバック用）:

```ts
type ExportCsvResult =
  | { ok: true; canceled?: boolean; message: string }   // message 例: 「コピーしました」「保存しました: foo.csv」
  | { ok: false; message: string }
```

処理:

1. 対象が `TableTab` かつ `tab.result` ありを確認（無ければ `{ ok: false }`）。
2. 列と行を決定:
   - `scope: 'page'` → `tab.result.columns`（列名）と `tab.result.rows` をそのまま使う。
   - `scope: 'all'` → `buildFilteredQuery(tab.tableName, tab.columns, tab.filters, { sort: tab.sort, limit: null })` を `window.api.query` で実行。**`tab.running` は立てない**（グリッドを「実行中…」で潰さないため）。失敗時は `{ ok: false, error.message }`。列は取得結果の `columns` を使う。
3. `all` で件数が多い場合（しきい値 **50,000 件**。`tab.total` が既知でそれを超える、または取得行数が超える）、`window.confirm('N 件をエクスポートします。よろしいですか？')` で確認。キャンセルなら `{ ok: true, canceled: true, message: '' }`。
4. `toCsv(columns, rows)` で CSV 文字列を生成。
5. `target: 'file'` → `window.api.saveCsv(defaultName, csv)`。`defaultName` は `` `${tab.tableName}.csv` ``。`canceled` ならその旨、成功なら `保存しました: <ファイル名>`。
   `target: 'clipboard'` → `navigator.clipboard.writeText(csv)` → `コピーしました`。
6. 例外・失敗は `{ ok: false, message }` で返す。

> 注: `exportCsv` は `tab.running` を変更しないため、エクスポート中もグリッド表示は維持される。連打対策・処理中表示は UI 側のローカル状態で扱う（下記）。

### 7. UI: エクスポートメニュー（`src/renderer/src/workspace/ExportMenu.tsx`・新規）

`FilterBar` のフッター（`Clear` / `Apply` の隣）に「エクスポート ▾」ボタンを置き、`ExportMenu` をマウントする。

- クリックでドロップダウンを開閉（外側クリックで閉じる。`ResultsGrid` の `ctxMenu` と同じ `mousedown` リスナ方式）。
- メニュー項目（上から）:
  - 現在のページを CSV 保存 … `{ scope: 'page', target: 'file' }`
  - 現在のページをコピー … `{ scope: 'page', target: 'clipboard' }`
  - （区切り線）
  - 全件を CSV 保存 … `{ scope: 'all', target: 'file' }`
  - 全件をコピー … `{ scope: 'all', target: 'clipboard' }`
- 項目クリックで `await exportCsv(...)`。実行中はローカル `busy` 状態でメニューを無効化（連打防止）。
- 結果フィードバック（コンポーネント内ローカル状態）:
  - `ok: true` かつ `message` あり → ボタン近傍に短い確認テキストを表示し、数秒後に自動的に消す（`setTimeout`）。
  - `ok: false` → `window.alert(message)`（既存の `window.confirm` と同じ素朴な方式に合わせる）。
- `tab.result` が無い／`tab.running` 中はボタンを無効化。

メニューと一時表示のロジックは `ExportMenu` 内で完結させ、肥大化している `FilterBar` には「ボタンを 1 つ置く」以上の責務を持たせない。

## エラーハンドリング

- 保存ダイアログのキャンセルはエラーではない（`canceled: true`）。無反応にせずメニューも通常状態へ戻す。
- ファイル書き込み失敗（権限など）はメイン側で正規化し `{ ok: false }` → UI で `alert`。
- `navigator.clipboard.writeText` の失敗（フォーカス喪失など）は catch して `{ ok: false }` → `alert`。
- `scope: 'all'` のクエリ失敗時はグリッドを潰さず（`tab.error` を変更しない）、`alert` のみで通知。

## テスト

`src/renderer/src/lib/csv.test.ts`（新規）で `toCsv` を網羅:

- ヘッダ + 複数行の基本変換（CRLF 区切り）。
- `null` / `undefined` → 空文字。
- カンマ・ダブルクォート・改行を含む値のクォート＆ `""` 2 重化。
- 数値・真偽値などの `String()` 変換。
- 列が空のときヘッダのみ／行が空のときヘッダ行のみ。
- BOM を含まないこと。

`filterBuilder.test.ts` に `limit: null` で `LIMIT` 句が出ないケースを追加（ソート・WHERE は従来どおり付くこと）。

`registerFileHandlers`（dialog/fs 依存）と `exportCsv`（`window.api`/clipboard 依存）、`ExportMenu`（DOM）は既存方針に合わせ単体テスト対象外とし、純粋関数（`toCsv` / `buildFilteredQuery`）にテストを集約する。

## 非スコープ

- SQL クエリタブからのエクスポート（上記理由により v1 対象外）。
- 区切り文字・エンコード・NULL 表現などのオプション設定 UI（YAGNI。CSV / UTF-8 BOM / 空セルに固定）。
- クリップボードを Excel セル貼り付け向けに TSV 化する対応（CSV テキストのまま）。
- TSV / JSON / Excel(.xlsx) など他形式への対応。
- エクスポート進捗バーやキャンセル（大量件数でも同期的に生成）。
