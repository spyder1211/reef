# テーブル一覧の右クリックメニュー（DROP / TRUNCATE）設計

作成日: 2026-06-10

## 背景

左サイドバーのテーブル一覧（`TableList.tsx`）は、各テーブルを `<button>` として描画し、クリックでテーブルタブを開く（`selectTable`）。現状、テーブルに対する破壊的操作（テーブル削除・空にする）を行う導線が UI に存在せず、ユーザーは SQL タブで手書き `DROP` / `TRUNCATE` を打つしかない。

本変更で、テーブル一覧項目の**右クリック（コンテキストメニュー）**から以下を実行できるようにする。

- **テーブルを空にする（TRUNCATE）** — 全行を削除。テーブル定義は残る。
- **テーブルを削除（DROP）** — テーブルごと削除。

`ResultsGrid.tsx` には既に HTML ネイティブ方式のコンテキストメニュー（セル右クリックでクイックフィルタ／行削除）が実装済みで、その state・dismiss・CSS パターンをそのまま流用する。

## スコープ

| 操作 | SQL | 確認 | 成功後の挙動 |
|---|---|---|---|
| TRUNCATE | `TRUNCATE TABLE \`name\`` | `window.confirm`（取り消し不可を明記） | 該当テーブルの開いているタブがあればステージをクリアして再実行（0件＋recount） |
| DROP | `DROP TABLE \`name\`` | `window.confirm`（取り消し不可を明記） | 該当テーブルの開いているタブを全て閉じ、`listTables()` を再取得して一覧更新 |

新規 IPC は追加しない。renderer 側で SQL を組み、既存の `window.api.query` で実行する（`filterBuilder` / `editBuilder` と同じ流儀）。

## 設計

### 1. SQL 組み立て（純関数・テスト対象）— `src/renderer/src/store/editBuilder.ts`

現在モジュール内 private な `quoteIdent`（バッククォート2重化エスケープ）を **export** 化し、以下2関数を追加する。`SqlStatement`（`{ sql: string; params: unknown[] }`）を返し、`params` は常に空配列（DDL のため値プレースホルダなし）。

```ts
export function quoteIdent(name: string): string

export function buildTruncateStatement(table: string): SqlStatement {
  return { sql: `TRUNCATE TABLE ${quoteIdent(table)}`, params: [] }
}

export function buildDropStatement(table: string): SqlStatement {
  return { sql: `DROP TABLE ${quoteIdent(table)}`, params: [] }
}
```

テーブル名はユーザーが入力する値ではなく `SHOW TABLES` 由来だが、識別子は必ず `quoteIdent` でエスケープし、バッククォートを含む名前でも壊れないようにする（既存 UPDATE/INSERT/DELETE と同方針）。

### 2. ストアアクション — `src/renderer/src/store/useAppStore.ts`

`AppState` に2アクションを追加する。

```ts
truncateTable: (name: string) => Promise<void>
dropTable: (name: string) => Promise<void>
```

#### `truncateTable(name)`

1. `window.confirm(\`テーブル \\\`${name}\\\` を空にします。全データが削除され、取り消せません。よろしいですか？\`)` が `false` なら何もしない。
2. `buildTruncateStatement(name)` で SQL を組み、`window.api.query(sql)` を実行。
3. 失敗（`!res.ok`）: `window.alert(res.error.message)`。
4. 成功: 該当テーブルの開いている `TableTab`（`selectTable` が同名タブを再利用するため最大1つ）について、`edits` / `inserts` / `deletes` / `editError` / `selectedRowIndex` をクリアし、`runTable(tab.id, { recount: true })` で再描画（0件・件数再取得）。タブが無ければ何もしない。
5. `try/catch` で IPC 例外を捕捉し、`window.alert` でメッセージ表示（タブを壊さない）。

TRUNCATE はステージ済みの編集対象行を消すため、ステージをクリアしないと無効な行キーに対する UPDATE/DELETE が残る。必ずクリアする。

#### `dropTable(name)`

1. `window.confirm(\`テーブル \\\`${name}\\\` を削除します。この操作は取り消せません。よろしいですか？\`)` が `false` なら何もしない。
2. `buildDropStatement(name)` で SQL を組み、`window.api.query(sql)` を実行。
3. 失敗（`!res.ok`）: `window.alert(res.error.message)`。一覧・タブは変更しない。
4. 成功:
   - 該当テーブル名の `TableTab`（最大1つ）を閉じる。閉じる場合は `pickNextActiveTabId(tabs, id, activeTabId)` で次の `activeTabId` を選び直す（既存 `closeTab` と同じヘルパー）。**破棄確認は出さない**（テーブルごと消えるため編集ステージは無意味。`closeTab` 経由ではなく直接 `tabs` をフィルタして確認をスキップする）。
   - `refreshTables()` を呼び、`window.api.listTables()` で `tables` を取り直す。
5. `try/catch` で IPC 例外を捕捉し、`window.alert` で表示。

#### `refreshTables()` ヘルパー（ストア内 private 関数）

`connect` 内のインライン処理（`const tbl = await window.api.listTables(); if (tbl.ok) set({ tables: tbl.data })`）を private 関数に切り出し、`connect` と `dropTable` の双方から呼ぶ（挙動不変のリファクタ）。

### 3. UI: コンテキストメニュー — `src/renderer/src/workspace/TableList.tsx`

`ResultsGrid.tsx` の方式を踏襲する。

- `ctxMenu` state を追加: `{ table: string; x: number; y: number } | null`。
- 各テーブル `<button>` に `onContextMenu` を付与:
  ```tsx
  onContextMenu={(e) => {
    e.preventDefault()
    setCtxMenu({ table: t, x: e.clientX, y: e.clientY })
  }}
  ```
- `document.mousedown` でメニューを閉じる `useEffect`（ResultsGrid と同一パターン）。
- メニュー本体（`ctxMenu` が非 null のとき固定配置で描画、`onMouseDown` は `stopPropagation`）。項目順は **TRUNCATE → セパレータ → DROP（危険）**:
  1. `テーブルを空にする（TRUNCATE）` → `truncateTable(ctxMenu.table)` を呼び `setCtxMenu(null)`
  2. `<div className={styles.ctxSep} />`
  3. `テーブルを削除（DROP）`（`ctxDanger` で赤表示）→ `dropTable(ctxMenu.table)` を呼び `setCtxMenu(null)`
- ストアから `truncateTable` / `dropTable` を取得して使う。

### 4. CSS — `src/renderer/src/workspace/TableList.module.css`

CSS Modules はファイル単位スコープのため、`ResultsGrid.module.css` の `ctxMenu` / `ctxItem` / `ctxSep` / `ctxDanger` 相当のスタイルを `TableList.module.css` に追加（同じ見た目を踏襲）。

## エラーハンドリング

- SQL 実行失敗（FK 制約・権限不足・ビューに対する DROP/TRUNCATE 等）は `ApiResult` の `error.message` を `window.alert` で表示。一覧・タブの状態は変更しない。
- IPC 例外は `try/catch` で捕捉し同様に `window.alert`。
- `window.confirm` / `window.alert` は同期 API。SQL 実行のみ非同期。

## テスト

- `src/renderer/src/store/editBuilder.test.ts` に追加:
  - `buildTruncateStatement('users')` → `` { sql: 'TRUNCATE TABLE `users`', params: [] } ``
  - `buildDropStatement('users')` → `` { sql: 'DROP TABLE `users`', params: [] } ``
  - バッククォートを含む名前（例: `` we`ird ``）が `` `we``ird` `` に2重化されること。
  - `quoteIdent` の export 化に伴う既存テストの維持。
- ストアアクション本体（`truncateTable` / `dropTable`）は `window.api` / `window.confirm` / `window.alert` 依存のため、既存方針（`useAppStore.ts` に直接のユニットテストを持たない）に従い、純関数の SQL ビルダのテストで主要ロジックをカバーする。
- `typecheck`（`tsc --noEmit`）と `test`（`vitest run`）が通ること。

## 非スコープ

- テーブル名タイプ一致のカスタム確認モーダル（YAGNI。`window.confirm` で十分との合意）。
- トースト／インライン通知（アプリに機構がないため `window.alert` を使用）。
- ビューに対する DROP/TRUNCATE の専用ハンドリング（`SHOW TABLES` はビューも含むが、エラーは `window.alert` で表示。v1 はフォローアップ扱い）。
- 「テーブル名をコピー」「開く」「リネーム」等の追加メニュー項目（今回の対象は TRUNCATE / DROP の2項目のみ）。
- 複数テーブルの一括選択・一括削除。
