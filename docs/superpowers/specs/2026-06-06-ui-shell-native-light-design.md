# UI 基盤スライス（Native Light シェル）設計書

- 作成日: 2026-06-06
- ステータス: ドラフト（設計合意済み）
- 親設計: [`2026-06-06-mysql-client-design.md`](./2026-06-06-mysql-client-design.md)（v1 全体像）

## 1. 背景（Context）

現状の UI（`src/renderer/src/App.tsx`）は「接続フォーム＋SQL欄＋結果表」を1画面にインラインstyleで並べただけの最小実装で、TablePlus を名乗るには見た目が貧弱。本スライスでは、親設計が描く v1 像のうち **UI の骨格（シェル）と接続管理の入口** を、**macOS 標準アプリ風（Native Light）** の品質で立ち上げる。

実物の TablePlus（保存済み接続リスト＋接続エディタ）を参照し、その体験を Native Light の世界観へ翻訳する。

## 2. 目的とゴール

- 起動直後に **保存済み接続リスト**（ホーム）が出て、選ぶと **Workspace シェル**（サイドバー＋タブ＋SQLエディタ＋結果グリッド）へ遷移する、本物の DB クライアントの佇まいを作る。
- インラインstyle を全廃し、**デザイントークン＋CSS Modules** に置き換える。
- SQL エディタを **CodeMirror 6**（SQLハイライト・行番号）にする。
- サイドバーに **接続中DBのテーブル一覧**（実データ）を出す。

### 非ゴール（本スライスでは作らない）

親設計の以下は本スライスの対象外（後続スライス）:
- セル/カラムのインライン編集、ステージング→コミット。
- カラム別 複数フィルタ、CSV/JSON/SQL エクスポート/インポート。
- SSH トンネル / SSL 接続、読み取り専用モード。
- スキーマツリーの階層（カラム/インデックス展開）、補完候補のスキーマ連動。
- 結果グリッドの仮想スクロール（TanStack Virtual）、クエリ履歴、再起動時のタブ復元。
- ダークテーマ、フレームレス独自タイトルバー。

## 3. スコープ（本スライス）

1. **ホーム画面（保存済み接続リスト）**: アバター＋名前＋カラータグ＋`host : db` の行、検索、`＋` で新規。
2. **接続フォームモーダル（簡易版）**: 名前・カラータグ・Host・Port・User・Password・Database。`保存 / テスト / 接続`。
3. **接続の永続化**: 接続メタは JSON、**パスワードは暗号化保存**（§5.1）。
4. **Workspace シェル**: サイドバー（接続情報＋テーブル一覧）＋タブバー＋CodeMirrorエディタ＋結果グリッド＋ステータスバー。
5. **テーブル一覧取得**: `SHOW TABLES` 相当でサイドバーに表示。
6. **基本操作**: 接続/切断、Cmd+Enter 実行、タブ追加/閉じる、テーブルクリックで `SELECT * FROM ... LIMIT 100` 実行。
7. **スタイル刷新**: Native Light のデザイントークン＋CSS Modules（インラインstyle全廃）。

## 4. 画面構成（2画面 ＋ 出し分け）

`App.tsx` を、状態 `activeConnection` の有無で出し分けるルーターにする。

- **Home**（`activeConnection == null`）: 左レール（ロゴ／アプリ名／`新規接続`・`設定`）＋ 中央（検索＋`＋`＋接続リスト）。`＋`・行の編集で接続フォームモーダル。
- **Workspace**（接続中）: 左サイドバー（接続ヘッダ：名前・`host:db`・状態ドット＋テーブル一覧＋`← 接続一覧`）／右（タブバー＋エディタ＋結果グリッド＋ステータスバー）。

### レイアウト要点
- ウィンドウは本スライスでは**標準のOSタイトルバー**のまま（フレームレス独自バーは後続）。
- エディタと結果グリッドは縦に上下分割（比率ドラッグは任意・後続でも可）。
- ステータスバー: `N 行 · M ms`、接続名/カラータグドット。

## 5. アーキテクチャ

親設計のプロセスモデル（メイン＝特権集約／レンダラ＝`contextIsolation`／preload で最小 API）を踏襲。既存の `ConnectionManager` / `registerDbHandlers` / preload を拡張する。

### 5.1 メイン側の追加

| モジュール | 本スライスでの責務 | 親設計との関係 |
|---|---|---|
| `ProfileStore`（新規） | 接続プロファイルの一覧/保存/削除を JSON 永続化。パスワードは暗号化して保存（エクスポート/インポートは後続） | 親設計の `ProfileStore` の最小実装 |
| `ConnectionManager`（拡張） | 既存の connect/query に加え `listTables()` を追加 | テーブル一覧。将来 `SchemaService`（カラム/ツリー/補完）へ発展 |

**パスワード保存（親設計との差分・要確認）**: 親設計は `keytar`（Keychain）と記載。本スライスでは **Electron 組込みの `safeStorage`** を採用する。`safeStorage.encryptString()` で暗号化したブロブ（base64）を `ProfileStore` の保存先に同梱し、接続時に復号する。理由: ネイティブモジュール依存（再ビルド）が無く、メンテが軽い。`safeStorage.isEncryptionAvailable()` が false の環境ではパスワードを永続化せず接続時に都度入力させる。→ **親設計もこの方式へ更新することを提案**。

- 保存先: `app.getPath('userData')/connections.json`（メタ）。パスワード暗号化ブロブは同 JSON 内に持つ（プロファイルとは別フィールド、レンダラには返さない）。

### 5.2 IPC / preload

`window.api` に型付きで追加（既存の `connect` / `query` と同じ判別共用体 `ApiResult<T>` を返す）:

- `connections.list(): ApiResult<ConnectionProfile[]>`
- `connections.save(input): ApiResult<ConnectionProfile>`（新規/更新）
- `connections.delete(id): ApiResult<void>`
- `connections.connect(id): ApiResult<void>`（保存済みプロファイルで接続。メインが暗号化パスワードを復号して `ConnectionManager.connect` を呼ぶ）
- `listTables(): ApiResult<string[]>`

既存の `connect(config: ConnectionConfig): ApiResult<void>`（フォームに入力中の生パスワードでの接続）はフォームの**テスト**および**未保存のまま接続**で利用する。保存済み行からの接続は `connections.connect(id)` を使う。

対応する `ipcMain.handle` を `registerDbHandlers`（または新規 `registerConnectionHandlers`）に追加。

### 5.3 shared/types.ts 追加

```ts
export type ConnectionTag = 'production' | 'staging' | 'development' | 'local' | 'none'

// レンダラに渡すプロファイル（パスワードを含まない）
export interface ConnectionProfile {
  id: string
  name: string
  tag: ConnectionTag
  host: string
  port: number
  user: string
  database?: string
}

// 保存入力（パスワードを含む。保存後はメインのみが暗号化保持）
export interface ConnectionProfileInput extends Omit<ConnectionProfile, 'id'> {
  id?: string
  password: string
}
```

### 5.4 レンダラ構成（責務分割）

状態は **Zustand**（既存依存）の単一ストア `store/useAppStore.ts` に集約。

- ストア状態: `profiles[] / search / activeConnection / status('idle'|'connecting'|'connected'|'error') / tabs[] / activeTabId / tables[] / formOpen / editingProfileId`
- `Tab`: `{ id, title, sql, result?, error?, running }`
- 主アクション: `loadProfiles / saveProfile / deleteProfile / connect(profile) / disconnect / addTab / closeTab / setTabSql(id,sql) / runActiveTab() / selectTable(name) / openForm(id?) / closeForm`

コンポーネント（小さく・単一責務）:

| 領域 | コンポーネント | 責務 |
|---|---|---|
| Home | `HomeScreen` | レール＋リスト＋検索の枠 |
| Home | `AppRail` | ロゴ・アプリ名・`新規接続`/`設定` |
| Home | `ConnectionList` / `ConnectionRow` | 接続行（`Avatar`＋名前＋`Tag`＋`host:db`、選択/編集/削除） |
| Home | `ConnectionFormModal` | 接続の新規/編集フォーム＋`保存/テスト/接続` |
| Workspace | `WorkspaceShell` | サイドバー＋メインの分割枠 |
| Workspace | `Sidebar` | 接続ヘッダ＋`TableList`＋`← 接続一覧` |
| Workspace | `TableList` | テーブル名一覧。クリックで `selectTable` |
| Workspace | `TabBar` | クエリタブ（追加`＋`/閉じる`×`） |
| Workspace | `QueryEditor` | CodeMirror 6 ラッパ。Cmd+Enter 実行 |
| Workspace | `ResultsGrid` | 結果表示（columns/rows、NULL 表現） |
| Workspace | `StatusBar` | 行数・実行時間・接続名/タグ |
| 共通 | `Avatar` / `Tag` | アバター丸／カラータグ |

### 5.5 結果グリッド（ResultsGrid）

親設計のグリッドは **TanStack Table + Virtual**。本スライスでは **TanStack Table** を採用してカラムモデル化しておき（将来のソート/編集の土台）、**仮想スクロール（TanStack Virtual）は後続**に回す。データ件数は当面 `LIMIT 100` 中心で素朴描画でも実用上問題ない。

## 6. 主なデータフロー / 挙動

- **起動**: `loadProfiles()` → Home 表示。
- **新規/編集**: `＋` or 行編集 → `ConnectionFormModal` → `保存`（`connections.save`）／`テスト`（一時 connect して疎通確認）／`接続`（保存して `connect`）。
- **接続**: 保存済み行は `connections.connect(id)`（メインが暗号化パスワードを復号し `ConnectionManager.connect`）、未保存フォームは `connect(config)` → 成功で `status=connected`、`listTables()` でサイドバー充填、空の `Query 1` タブを開いて Workspace へ。
- **テーブルクリック**: アクティブタブの SQL を ``SELECT * FROM `name` LIMIT 100;`` にして実行。
- **実行**: Cmd+Enter または実行ボタン → `query(sql)` → 結果/エラーを当該タブへ。
- **切断/戻る**: `← 接続一覧` で `disconnect` → Home へ。

## 7. ビジュアルデザイン（Native Light トークン）

`theme.css` に CSS 変数で定義し、各コンポーネントは CSS Modules から参照。

```
--bg:           #ffffff
--bg-sidebar:   #f5f5f7
--bg-rail:      #f0f0f2
--bg-subtle:    #f0f0f2   /* 検索/ボタン地 */
--border:       #e5e5ea
--border-soft:  #ededf0
--text:         #1d1d1f
--text-muted:   #86868b
--text-faint:   #9a9aa0
--accent:       #0a6cff   /* 選択/主ボタン（Apple ブルー）*/
--accent-fg:    #ffffff
--row-alt:      #fafafb
--radius:       8px  /  --radius-lg: 12px
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
--font-mono: "SF Mono", Menlo, monospace
```

カラータグ色: production `#ff453a` / staging `#0a84ff` / development `#30b0c7` / local `#34c759` / none `#8e8e93`。アバター丸はタグ色地＋白2文字イニシャル。選択行は `--accent` 地に白文字。

SQL ハイライト（CodeMirror テーマ・Native Light）: keyword `#0a6cff` / string `#d12f1b` / number 同 string 系 / 既定 `#1d1d1f`、行番号 `--text-faint`、現在行ハイライトは淡いグレー。

## 8. エラー / 空状態

- 接続エラー: フォームモーダル内に MySQL のコード/メッセージ（既存 `normalizeDbError`）を表示。`status=error`。
- クエリエラー: 結果ペインにエラーコード/メッセージ。
- 空状態: 接続0件のホーム＝「`＋` から最初の接続を作成」、テーブル0件のサイドバー＝「テーブルがありません」、結果未実行＝プレースホルダ。
- `safeStorage` 不可: フォームに「この環境ではパスワードを保存できません（接続時に入力）」の注記。

## 9. テスト戦略

親設計の TDD 方針を踏襲。

- **単体（Vitest, TDD）**:
  - `ProfileStore`: 保存/一覧/削除、パスワード暗号化往復（`safeStorage` はモック）、レンダラ向け出力にパスワードを含めないこと。
  - Zustand ストアの純ロジック（`addTab/closeTab/selectTable` が生成する SQL 等）。
- **結合（Docker MySQL）**: `ConnectionManager.listTables()`（既存 `ConnectionManager.integration.test.ts` に倣う）。
- **目視確認**: 実アプリ（`localhost:5173` / electron-vite dev）で Home→接続→テーブル→実行までを確認。

## 10. 実装フェーズ（計画フェーズで詳細化）

1. shared 型追加 → `ProfileStore`（TDD）→ `ConnectionManager.listTables`（結合）→ IPC/preload 配線。
2. レンダラ基盤: `theme.css`＋CSS Modules 体制、Zustand ストア、`App` ルーター化（インラインstyle 撤去）。
3. Home: `AppRail` / `ConnectionList` / `ConnectionRow` / `ConnectionFormModal` / `Avatar` / `Tag`。
4. Workspace: `Sidebar` / `TableList` / `TabBar` / `QueryEditor`(CodeMirror) / `ResultsGrid`(TanStack Table) / `StatusBar`。
5. 配線: 接続フロー・実行（Cmd+Enter）・テーブルクリック・タブ操作・空/エラー状態。

## 11. 未決事項 / 確認したい点

- **パスワード保存方式**: 本スライスは `safeStorage` を採用（親設計の `keytar` 記載を更新提案）。問題なければ親設計も追従更新する。
- アプリ表示名は仮で「MySQL Client」。正式名称があれば差し替え。
- カラータグは固定5種（production/staging/development/local/none）で開始。任意色は後続。
