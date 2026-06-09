# サイドバーのテーブル検索・ジャンプ — 設計ドキュメント

**日付**: 2026-06-09
**ステータス**: 承認済み（実装計画へ移行）
**関連 issue**: #10「GUIでのデータ閲覧・フィルタ・ソート・ページングを強化する」

## 1. 目的

issue #10 を独立サブプロジェクトに分解したうちの **A. サイドバーのテーブル検索・ジャンプ** を実装する。
サイドバーのテーブル一覧（`TableList`）は現状すべてのテーブルを素のリストで並べるだけで、検索手段がない。テーブル数が増えると目的のテーブルへ到達しづらい。

ここに以下を追加し、受け入れ条件「SQL を書かずにテーブルを **探し**、開ける」を満たす:

1. **インクリメンタル検索**（入力と同時に一覧を絞り込み、一致部分をハイライト）
2. **キーボードジャンプ**（↑↓で候補移動、Enter で開く）
3. **グローバルフォーカスショートカット**（接続中に ⌘P で検索ボックスへフォーカス）

## 2. スコープ

- **対象**: サイドバーのテーブルナビゲーション（`TableList`）。接続済みワークスペースのみ。
- **対象外**: SQL タブ／結果グリッド側、フィルタバー、ページング。これらは issue #10 の別サブプロジェクト（B〜F）として扱う。
- **方針**: ストア・IPC・メインプロセス・preload は無変更。レンダラ内で自己完結させる（最小・無リスク）。`pager.ts` / `csv.ts` と同じ「純粋関数＋ユニットテスト」パターンに揃える。

## 3. アーキテクチャ

### 3.1 コンポーネント構成

`TableList.tsx` を「テーブルナビゲータ」として拡張する（1つの凝集した責務: テーブルを探して開く）。純粋ロジックは `lib/tableSearch.ts` に分離してユニットテスト可能にする。

```
Sidebar
└─ TableList            … 検索ボックス + フィルタ済みリスト + ↑↓/Enter + ⌘P フォーカス
   └─ (lib/tableSearch) … filterTables / matchRange（純粋・テスト対象）
```

### 3.2 状態（すべて `TableList` のローカル state、ストア非依存）

- `query: string` — 検索文字列
- `activeIndex: number` — ↑↓でハイライト中の行（フィルタ済みリスト内の index）
- `inputRef: RefObject<HTMLInputElement>` — ショートカットでフォーカスするための ref

検索文字列は揮発的な UI 状態のためグローバルストアには載せない。

### 3.3 純粋ロジック（`src/renderer/src/lib/tableSearch.ts` 新規）

```ts
// 大文字小文字を無視した部分一致。query が空白のみ/空なら全件をそのまま返す。
export function filterTables(tables: string[], query: string): string[]

// 最初の一致範囲（[start, end) の半開区間）。ハイライト描画用。
// 一致なし／空クエリは null。indexOf ベースのため正規表現エスケープ不要
// （`_` `%` `.` などの特殊文字も literal 扱い）。
export function matchRange(name: string, query: string): { start: number; end: number } | null
```

実装方針:
- `filterTables`: `query.trim()` が空なら入力配列をそのまま返す。それ以外は `name.toLowerCase().includes(q.toLowerCase())` で絞り込む。
- `matchRange`: `query.trim()` が空なら `null`。`name.toLowerCase().indexOf(q.toLowerCase())` が `-1` なら `null`、見つかれば `{ start: idx, end: idx + q.length }`。トリム前の元 `query` ではなくトリム後の文字列長で `end` を算出する（前後空白がハイライト幅に混ざらないようにする）。

### 3.4 データフロー / 振る舞い

- 入力するたび `filterTables(tables, query)` で再フィルタ。`query` 変更時に `activeIndex` を 0 にリセットする。
- リスト行は `matchRange` の結果で `前 / 一致 / 後` の3片に分割し、一致部分をハイライト（`<mark>` 相当のスタイル）。`matchRange` が `null`（＝クエリ空）のときはテーブル名をそのまま表示する。
- 検索ボックス内のキー操作:
  - `↓` / `↑`: `activeIndex` を移動（端でクランプ＝ラップなし）。アクティブ行が見えるよう自動スクロール（`scrollIntoView({ block: 'nearest' })`）。
  - `Enter`: アクティブ行（フィルタ済みリストが空でなければ既定 index 0）の `selectTable(name)` を呼ぶ。クエリとフォーカスは維持し、連続でテーブルを開けるようにする。
  - `Esc`: クエリが非空ならクリア（フォーカスは維持）。クエリが空ならボックスを blur する（二段挙動）。
- マウスクリックは従来どおり `selectTable(name)`。ホバー行とキーボードのアクティブ行にスタイルを付ける。

### 3.5 グローバルフォーカスショートカット

- ワークスペース表示中（`TableList` がマウントされている間）に `window` の `keydown` を `useEffect` で監視する。
- **⌘P**（macOS は `e.metaKey`、その他は `e.ctrlKey`、かつ `e.key === 'p'`）で `e.preventDefault()` → `inputRef.current?.focus()` し、既存テキストを選択状態にする（`select()`）。
- `editMenu` 標準やアプリメニューに ⌘P の割り当てはなく（menu.ts 確認済み）、メニューに横取りされず renderer に届く。
- リスナーは `TableList` のアンマウント時に解除する。

## 4. 空・端・エラーの扱い

- テーブル0件（`tables.length === 0`）: 既存どおり「テーブルがありません」。検索ボックスは非表示（または無効）にする。
- 検索一致0件: 「該当なし」を表示し、`Enter` は何もしない。
- フィルタでリストが縮んだ場合: `activeIndex` を `[0, filtered.length - 1]` にクランプ。
- ネットワーク／DB に触れない純粋なクライアント内機能のため、新たな失敗経路はない。`selectTable` の既存挙動（同名タブがあれば再利用、未取得 PK の取得、未コミット変更確認など）はそのまま。

## 5. テスト

- **`tableSearch.test.ts`（DB不要・純粋関数）**:
  - `filterTables`:
    - 空クエリ／空白のみクエリ → 全件をそのまま返す
    - 大文字小文字を無視して一致
    - 部分一致するものだけを残す
    - 特殊文字（`_` `%` `.`）を literal 扱い（正規表現にならない）
  - `matchRange`:
    - 先頭／中間／末尾一致で正しい `{ start, end }`
    - 大文字小文字を無視
    - 空クエリ／一致なしは `null`
    - 前後空白付きクエリでも `end - start` がトリム後の長さに一致
- **手動確認**: ↑↓ の移動とクランプ、Enter で開く、Esc の二段挙動、⌘P でフォーカス＋全選択、一致部分ハイライト。コンポーネントのキーボード挙動は既存方針（純粋ロジックのみ自動テスト）に合わせ手動で確認する。

## 6. 変更ファイル

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/renderer/src/lib/tableSearch.ts` | 新規 | `filterTables` / `matchRange`（純粋関数） |
| `src/renderer/src/lib/tableSearch.test.ts` | 新規 | 上記のユニットテスト |
| `src/renderer/src/workspace/TableList.tsx` | 変更 | 検索ボックス・キーボードナビ・ハイライト・⌘P リスナー |
| `src/renderer/src/workspace/TableList.module.css` | 変更 | 検索ボックス・ハイライト・アクティブ行スタイル |

ストア（`useAppStore.ts`）・IPC・メインプロセス・preload は無変更。

## 7. 既知の制約（v1 で許容）

- マッチは部分一致のみ（あいまい一致＝サブシーケンスは非対応）。issue #10 の別フェーズで必要になれば拡張する。
- ショートカットキーは ⌘P 固定（設定でのカスタマイズなし）。将来ネイティブメニュー（Go → Find Table）として出す場合は別 PR で IPC 経由にする。
- サイドバーのリストは仮想化しない（テーブル数は通常そこまで多くない想定。大量行の仮想化は issue #10 の別サブプロジェクト E の領域）。
