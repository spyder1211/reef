# コネクション一覧の2階層グループ化（グループ × 環境タグ）設計

作成日: 2026-06-10

## 背景

ホーム画面のコネクション一覧（`ConnectionList.tsx`）は、保存済み接続（`ConnectionProfile`）を**フラットなリスト**として描画し、検索ボックスのテキスト一致で絞り込むだけである（`filterProfiles`）。接続数が増えると目的の接続を探しにくく、TablePlus のような**グループ単位の整理**ができない。

一方、接続には既に環境を表す `tag`（`production` / `staging` / `development` / `local` / `none`）が実装済みで、色（`TAG_COLORS`）とラベル（`TAG_LABELS`）、表示順（`TAG_ORDER`）も `lib/tags.ts` に定義され、アバター色と小さな文字ラベルで表示されている。しかしタグ単位でまとめて表示する仕組みはない。

本変更で、TablePlus 同等の **2階層グループ表示**を導入する。

- **上位グループ**（例:「都留シビックテック」「製造業」）= ユーザーが作成する名前付きグループ。
- **環境サブグループ**（local / staging / production …）= 各接続の既存 `tag` から**表示時に導出**（保存しない）。
- 接続はグループ間を**ドラッグ＆ドロップで移動**でき、上位グループ自体も**ドラッグで並び替え**できる。

## スコープ

| 項目 | 内容 |
|---|---|
| 上位グループ | ユーザー作成。名前付き。`order` で並び替え（DnD）。リネーム・削除可 |
| 環境サブグループ | 接続の `tag` から導出。`TAG_ORDER` 順。接続が1件以上ある tag のみ表示 |
| 接続の所属 | `groupId`（未設定＝「未分類」）。DnD でグループ間移動（`groupId` のみ変更、`tag` は変えない） |
| グループ削除 | 中の接続は削除せず「未分類」へ退避（`groupId` を外す） |
| 折り畳み | グループ単位で展開/折り畳み。状態は永続化しない（セッション内のみ、レンダラ state） |
| 検索 | 接続の一致でフィルタ。一致を含むグループは自動展開、空グループは非表示 |
| DnD 実装 | ネイティブ HTML5 Drag and Drop。**追加依存なし** |

接続フォーム（`ConnectionFormModal.tsx`）は**変更しない**。グループ割り当ては DnD に一本化し、新規接続は「未分類」に入る。タグ集合（enum）も変更しない。

## 設計

### 1. 共有型 — `src/shared/types.ts`

新エンティティと、接続への所属フィールドを追加する。

```ts
// 接続グループ（上位グループ）
export interface ConnectionGroup {
  id: string
  name: string
  order: number // 並び替え用。小さいほど上に表示
}
```

`ConnectionProfile` と `ConnectionProfileInput` の双方に `groupId?: string` を追加する（未設定＝「未分類」）。`StoredProfile`（`ProfileStore.ts`）は `ConnectionProfile` を継承しているため自動的に持つ。

### 2. 永続化ドキュメントの拡張 — `connections.json`

現状 `{ profiles: StoredProfile[] }` を **`{ profiles: StoredProfile[]; groups: ConnectionGroup[] }`** に拡張する。

**マイグレーション（破壊的変更なし）**:
- 既存ファイルに `groups` が無い → `[]` として扱う。
- `groupId` を持たない既存接続 → `undefined` のまま（表示時に「未分類」へ）。
- 不正・読み取り失敗時は従来どおり `{ profiles: [], groups: [] }` 相当を返す。

#### 2.1 永続化 deps をドキュメント単位に一般化 — `createProfileStore.ts` / `ProfileStore.ts`

現在の `ProfileStoreDeps` は `load(): StoredProfile[]` / `persist(profiles: StoredProfile[])` と**プロファイル配列のみ**を扱う。グループも同じファイルに同居させ、`GroupStore` と `ProfileStore` が**同一ドキュメントを read-modify-write** できるよう、deps をドキュメント単位に変更する。

```ts
export interface StoredDoc {
  profiles: StoredProfile[]
  groups: ConnectionGroup[]
}

export interface StoreDeps {            // 旧 ProfileStoreDeps を一般化
  load(): StoredDoc
  persist(doc: StoredDoc): void
  secret: SecretBox
  genId(): string
}
```

`createProfileStore.ts` の `load` / `persist` を `StoredDoc` 対応に書き換える（`profiles` / `groups` 両方を読み書き。後方互換で `groups` 欠落時は `[]`）。各操作は必ず**ドキュメント全体を読み込み→該当スライスを変更→全体を保存**する（IPC は逐次実行のため競合なし。スライスだけ保存して他方を消す事故を防ぐ）。

`ProfileStore` と `GroupStore` が**同一の `StoreDeps` インスタンスを共有**できるよう、`createProfileStore.ts` を **`createConnectionStores(): { profileStore: ProfileStore; groupStore: GroupStore }`** にリファクタする（共有 deps を1つ構築し、両ストアに渡す）。`src/main/index.ts:53` の `registerConnectionHandlers(manager, createProfileStore())` を `createConnectionStores()` の分割代入に合わせて更新する。

> 命名整理: `ProfileStoreDeps` → `StoreDeps`、deps の戻り値が `StoredDoc` になることで `ProfileStore` 内の `this.deps.load()` は `.profiles` 参照に変わる。既存 `ProfileStore.test.ts` の `FakeDeps` も `StoredDoc` を返すよう更新する。

### 3. `ProfileStore` の変更 — `src/main/connection/ProfileStore.ts`

- `list()` / `save()` / `delete()` / `getConnectConfig()` を `StoredDoc.profiles` ベースに更新（挙動は不変、`groupId` を保持するだけ）。
  - `save()`: `input` に `groupId` プロパティが**有る**場合のみその値を `stored` に反映し、**無い**場合は更新対象の既存 `groupId` を保持する（新規作成時は `undefined`＝未分類）。詳細は下記注記。
- 新メソッド **`move(profileId: string, groupId: string | null): void`**: 対象接続の `groupId` を設定（`null` で「未分類」へ）。存在しなければ no-op。

> **`save()` の groupId 保持**: 接続フォームは `groupId` を送らない。`save()` が `input.groupId`（undefined）で上書きすると DnD で設定した所属が消える。よって `save()` は「更新時、`input` に `groupId` プロパティが**無い**場合は既存の `groupId` を保持」する。`ConnectionProfileInput.groupId` はオプショナルのままとし、フォーム保存では touch しない。割り当ては常に `move()` 経由。

### 4. `GroupStore` 新設 — `src/main/connection/GroupStore.ts`

`StoreDeps` を共有して `StoredDoc.groups` を操作する純粋なCRUD。

```ts
list(): ConnectionGroup[]                       // order 昇順で返す
create(name: string): ConnectionGroup           // 末尾 order（max+1）を採番、id は genId()
rename(id: string, name: string): void          // 空名は無視（no-op）
delete(id: string): void                        // group を除去し、所属接続の groupId を外す（未分類へ）
reorder(orderedIds: string[]): void             // 与えられた順に order を 0..n-1 で振り直す
```

- `create`: `name` を trim。空なら作成しない（呼び出し側でバリデーションするが store でも防御）。
- `delete`: `groups` から除去すると同時に、`profiles` 内の `groupId === id` を `undefined` に。**1回の persist で原子的に**行う。
- `reorder`: `orderedIds` に含まれない既存グループは末尾に温存（防御的）。

### 5. IPC ハンドラ — `src/main/ipc/registerConnectionHandlers.ts`

ハンドラのシグネチャを **`registerConnectionHandlers(manager, profileStore, groupStore)`** に拡張し（`createConnectionStores()` から両ストアを受け取る）、以下チャンネルを追加。すべて `ApiResult<T>` で返す（既存方針）。`groups:create` の `name` 空・`connections:move` の不正 id 等は store 側 no-op に委ね、IPC は `try/catch`＋`normalizeDbError` の既存形を踏襲する。

戻り値はすべて `ApiResult<T>`（`void` 相当は既存 `connections:delete` と同じく `ApiResult<null>`／`data: null`）。

| チャンネル | 入力 | data |
|---|---|---|
| `groups:list` | – | `ConnectionGroup[]` |
| `groups:create` | `name: string` | `ConnectionGroup` |
| `groups:rename` | `id, name` | `null` |
| `groups:delete` | `id: string` | `null` |
| `groups:reorder` | `orderedIds: string[]` | `null` |
| `connections:move` | `profileId, groupId: string \| null` | `null` |

preload（`src/preload/index.ts`）の `api` オブジェクトに `groups.{list,create,rename,delete,reorder}` と `connections.move` のブリッジを追加する。**型定義は `typeof api` 由来ではなく `src/renderer/src/env.d.ts` に手書きの `Window.api` インターフェース**があるため、そちらにも同じシグネチャを追記し、両ファイルに `ConnectionGroup` の import を加える（preload は型 import のみ）。

```ts
// 追記する戻り型（env.d.ts / preload 双方）
groups: {
  list: () => Promise<ApiResult<ConnectionGroup[]>>
  create: (name: string) => Promise<ApiResult<ConnectionGroup>>
  rename: (id: string, name: string) => Promise<ApiResult<null>>
  delete: (id: string) => Promise<ApiResult<null>>
  reorder: (orderedIds: string[]) => Promise<ApiResult<null>>
}
// connections に追加
move: (profileId: string, groupId: string | null) => Promise<ApiResult<null>>
```

### 6. レンダラ状態（zustand） — `src/renderer/src/store/useAppStore.ts`

`AppState` に追加:

```ts
groups: ConnectionGroup[]
collapsed: Record<string, boolean>        // key=groupId（"__ungrouped__" 含む）, true=折り畳み

loadGroups: () => Promise<void>           // groups:list を取得
createGroup: (name: string) => Promise<void>
renameGroup: (id: string, name: string) => Promise<void>
deleteGroup: (id: string) => Promise<void>
reorderGroups: (orderedIds: string[]) => Promise<void>
moveProfileToGroup: (profileId: string, groupId: string | null) => Promise<void>
toggleCollapse: (groupId: string) => void
```

- 各 mutation は IPC 実行後に `loadProfiles()` / `loadGroups()` で再取得（既存 `saveProfile` 等と同じ流儀。楽観更新はしない）。
- `loadProfiles`（既存）の呼び出し箇所（`App.tsx` の初期化）で `loadGroups` も呼ぶ。

### 7. グルーピング純関数 — `src/renderer/src/lib/grouping.ts`（新規）

**DOM 非依存・ユニットテストの中心**。一覧描画用のビューモデルを組み立てる。

```ts
const UNGROUPED_ID = '__ungrouped__'

interface EnvSubgroup { tag: ConnectionTag; profiles: ConnectionProfile[] }
interface GroupView  { id: string; name: string; subgroups: EnvSubgroup[]; count: number }

function buildGroupedView(
  profiles: ConnectionProfile[],
  groups: ConnectionGroup[],
  search: string
): GroupView[]
```

ルール:
1. `search` を trim・lowercase し、`filterProfiles` 相当（name/host/database 一致）で接続を絞り込む。
2. 接続を `groupId` ごとに振り分け。`groupId` が未設定 or 実在しないグループを指す場合は「未分類」（`UNGROUPED_ID`）へ。
3. 上位グループは `groups` の `order` 昇順。**末尾に「未分類」**（接続がある場合のみ）。
4. 各グループ内で `tag` ごとにサブグループ化し、`TAG_ORDER` の順に並べる。**接続0件の tag サブは出さない**。
5. 検索時（`search` 非空）は**接続0件のグループを除外**（空グループを表示しない）。検索なしのときは接続0件の作成済みグループも見出しだけ表示する（ドロップ先として残す）。
6. 各 `GroupView.count` は配下接続数。

`UNGROUPED_ID` と「未分類」表示名はこのモジュールから export する。

### 8. UI コンポーネント

#### 8.1 `ConnectionList.tsx`（改修）

- `buildGroupedView(profiles, groups, search)` を呼び、`GroupView[]` を得る。
- 空状態の文言は現状を踏襲（接続0件・検索不一致）。
- 各 `GroupView` を **`GroupSection`** で描画。
- 一覧上部（`HomeScreen.tsx` の `top` 行、検索ボックス付近）に **「＋グループ」アクション**を追加。クリックで新規グループ名の入力（インライン or `window.prompt` で簡易に）→ `createGroup(name)`。新規接続の「＋」とは別ボタン。

#### 8.2 `GroupSection.tsx`（新規）

1グループ分の見出し＋配下を描画する。

- **見出し行**: `▶/▼`（折り畳みトグル、`toggleCollapse`）、グループ名、件数バッジ。
  - **ダブルクリックでインラインリネーム**（`<input>` 化 → blur/Enter で `renameGroup`、Esc で取消）。
  - **右クリックで削除メニュー**（`ResultsGrid` / `TableList` 同様のネイティブ context menu パターン）。削除時 `window.confirm`（「グループ『X』を削除します。中の接続は未分類へ移動します。」）→ `deleteGroup`。
  - 「未分類」グループはリネーム/削除/並び替え**不可**（見出しのみ・ドロップ先としては有効）。
- **配下**: 折り畳み時は非表示。展開時は `EnvSubgroup` ごとに小見出し（タグ色のドット＋ラベル＝`TAG_LABELS`/`TAG_COLORS`）を出し、その下に `ConnectionRow` 群。
  - 検索時は該当グループを強制展開（`collapsed` を無視して開く）。

#### 8.3 `ConnectionRow.tsx`（小改修）

- 行を `draggable` にし、`onDragStart` で `dataTransfer.setData('application/x-tableplus-conn', profile.id)`、`effectAllowed='move'`。
- 既存のダブルクリック接続・編集/削除/接続ボタンは維持。
- 行内の `Tag` チップは**サブグループ見出しと重複**するため、グループ表示文脈では非表示にしてよい（任意・軽微。アバター色は残す）。判断は実装時に最小変更で。

### 9. ドラッグ＆ドロップ仕様（ネイティブ HTML5）

`dataTransfer` の MIME で種別を判別する。

- **接続のドラッグ**: `ConnectionRow` の `onDragStart` で MIME `application/x-tableplus-conn` に `profileId`。
- **グループのドラッグ**: `GroupSection` 見出しの `onDragStart` で MIME `application/x-tableplus-group` に `groupId`（「未分類」は draggable=false）。
- **ドロップ先 = グループ（`GroupSection` ルート要素 / 見出し）**:
  - `onDragOver`: `application/x-tableplus-conn` を含むなら `preventDefault()`＋ドロップ可ハイライト。
  - `onDrop(conn)`: `moveProfileToGroup(profileId, targetGroupId)`（「未分類」へのドロップは `groupId=null`）。同一グループへのドロップは no-op。
  - `onDragOver`/`onDrop(group)`: `application/x-tableplus-group` を含むなら**並び替え**。ドロップ対象グループの位置に挿入し、`reorderGroups(orderedIds)` を呼ぶ。「未分類」は並び替え対象外（その前後への挿入は末尾扱い）。
- 並び替えの順序計算は純関数 **`computeReorder(orderedIds, draggedId, targetId)`**（`lib/grouping.ts`）に切り出してユニットテストする。

ハイライト等の視覚フィードバックは CSS Module（`GroupSection.module.css`）で最小限に。

## エラーハンドリング

- IPC（`groups:*` / `connections:move`）は `ApiResult` を返し、失敗時はストア側で握りつぶさず `window.alert(error.message)`（破壊的でない操作のため簡易通知。既存 `dropTable` 等と同方針）。
- `createGroup` / `renameGroup` で空名・空白のみは送らない（UI でバリデーション、store でも防御）。
- 存在しない `groupId`/`profileId` を指す操作は main 側で no-op（例外を投げない）。
- DnD で同一グループへ落とした・自分自身の位置へ並び替えた場合は no-op（無駄な IPC を出さない）。

## テスト

TDD で進める。純ロジックを中心に検証する（既存方針＝`useAppStore` 直接のユニットテストは持たず、純関数に寄せる）。

- **`src/renderer/src/lib/grouping.test.ts`**（新規）:
  - `buildGroupedView`: order 昇順、未分類が末尾、tag サブが `TAG_ORDER` 順、空 tag サブ除外、検索で空グループ除外・検索なしで空グループは見出し保持、未知 `groupId` は未分類扱い。
  - `computeReorder`: 上へ/下へ移動、先頭/末尾、自分自身への移動が no-op。
- **`src/main/connection/GroupStore.test.ts`**（新規、`ProfileStore.test.ts` の `FakeDeps`/`StoredDoc` 流儀）:
  - `create`（order 採番）、`rename`（空名 no-op）、`reorder`、`delete`（所属接続の groupId が外れる＝未分類化）を検証。
- **`src/main/connection/ProfileStore.test.ts`**（更新）:
  - `StoredDoc` 対応に `FakeDeps` を更新し既存挙動を維持。
  - `save()` 更新時に `input.groupId` 未指定なら既存 `groupId` を保持すること。
  - `move()` で `groupId` 設定 / `null` で未分類化。
- `typecheck`（`tsc --noEmit`）と `test`（`vitest run`）が全て通ること。

## 非スコープ（v1 では実装しない）

- 3階層以上のネスト / グループのネスト（上位グループは1階層のみ）。
- 環境サブグループの手動作成・リネーム・並び替え（tag 由来の自動表示のみ）。
- ドロップで `tag`（環境）を変更する挙動（`groupId` のみ変更で合意）。
- 接続フォームへのグループ選択 UI 追加（DnD 一本化）。
- 折り畳み状態のディスク永続化（セッション内のみ。再起動で全展開）。
- タグ集合（enum）の変更・日本語ラベル化。
- グループ色・アイコンのカスタマイズ。
- 接続行の並び替え（グループ/サブ内の手動ソート）。
