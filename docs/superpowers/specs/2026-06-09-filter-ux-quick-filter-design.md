# フィルタUX改善 + カラム右クリック quick filter — 設計ドキュメント

**日付**: 2026-06-09
**ステータス**: 承認済み（実装計画へ移行）
**関連 issue**: #10「GUIでのデータ閲覧・フィルタ・ソート・ページングを強化する」
**サブプロジェクト**: B（issue 項目3「フィルタ条件の追加・複製・解除・適用状態を分かりやすくする」＋ 項目4「カラム右クリックから quick filter」）

## 1. 目的

テーブルタブのフィルタ体験を「絞り込みが分かりやすい」状態へ引き上げる。具体的には:

1. **カラム右クリック quick filter（即適用）** — グリッドのセルを右クリックし、その列・値に基づく絞り込みをワンアクションで適用する。
2. **フィルタ条件の複製** — 既存条件を1クリックで複製する。
3. **適用状態の正確な可視化** — いま表示中の結果がどのフィルタによるものか、未適用の編集があるかを明確にする。

受け入れ条件（issue #10）のうち「SQL を書かずに絞り込み」「フィルタ/ソート/ページングの状態が UI 上で理解しやすい」を直接満たす。

## 2. スコープ

- **対象**: テーブルタブ（`TableTab`）のみ。クエリをこちらで組み立てているため安全に条件追加・適用できる。
- **対象外**: SQL タブ（`SqlTab`）。ユーザーの手書き SQL は書き換えない。セル右クリックの quick filter もテーブルタブ限定（ソートと同じ方針）。
- **無変更**: IPC・メインプロセス・preload・`src/shared/types.ts`。すべてレンダラ内で完結する。

## 3. アーキテクチャ

### 3.1 quick filter（即適用）

#### ResultsGrid のセルコンテキストメニュー（統合）

現状、データ行の右クリックは `<tr>` の `onContextMenu` で「行を削除」メニュー（主キーあり時のみ）を出す。これを `<td>` の右クリックに移し、クリックしたセルの **列名と値** を取得できるようにする。

- メニューを出すのは **テーブルタブのときのみ**（`onQuickFilter` コールバックが渡されているか否かで判定）。SQL タブは従来どおりブラウザ既定の右クリックに任せる。
- データセルのメニュー項目:
  - セル値が `null`/`undefined`: `IS NULL` / `IS NOT NULL`
  - セル値が非NULL: `= この値で絞り込む` / `≠ この値` / `含む`
  - **編集可能テーブル（主キーあり）のみ**、区切り線の下に行操作: 削除予定でなければ `行を削除`、削除予定なら `削除を取り消す`
- 新規（INSERT）行のセルは従来どおり `この新規行を破棄` のみ（quick filter は出さない＝未コミット行の値で絞る意味がないため）。
- 非編集テーブル（主キーなし）でも quick filter は機能する（現状は右クリック無反応のため改善になる）。
- quick filter に渡す値は **元の行の DB 値**（`original[column]`。ステージング中の編集値ではなく永続値）。

`CtxMenu` の型を、行キー中心から「セル＋行」を持つ形に再設計する（概念）:

```ts
type CtxMenu =
  | {
      kind: 'cell'
      x: number
      y: number
      column: string
      value: unknown
      rowKey: string
      pkValues: Record<string, unknown>
      isDeleted: boolean
      // 行操作（削除/取消）を出すかは Grid 側で onStageDelete の有無＝editable で判定
    }
  | { kind: 'insert'; x: number; y: number; localId: string }
```

#### store アクション `quickFilter`

```ts
quickFilter: (
  tabId: string,
  column: string,
  operator: FilterOperator, // '=' | '<>' | 'contains' | 'is_null' | 'is_not_null'
  value: unknown
) => Promise<void>
```

挙動:
1. `confirmDiscard(tab)` で未コミットのセル編集があれば確認（`applyFilters` と同じ作法）。
2. `value == null ? '' : String(value)` を主値に、`enabled: true` の `FilterCondition` を生成して `filters` の末尾に **追加**。
3. `page=0`・編集ステージ（edits/inserts/deletes）リセット・`appliedFilters` を新しい filters でスナップショット。
4. `runTable(tabId, { recount: true })` を実行（即適用）。

`is_null`/`is_not_null` は値なし条件（`value: '', value2: ''`）。`=`/`<>`/`contains` は value ベース。

### 3.2 フィルタ条件の複製

各フィルタ行に複製ボタン（⧉）を追加し、store アクションを足す:

```ts
duplicateFilter: (tabId: string, filterId: string) => void
```

- 対象条件と同じ `enabled/column/operator/value/value2` を持つ新しい id の条件を生成し、元の直後に挿入する。
- 適用はしない（バーの編集状態が変わるだけ＝未適用になり得る、3.3 の dirty 判定に従う）。

### 3.3 適用状態の正確な可視化

#### 状態（`TableTab` に追加）

`src/renderer/src/store/useAppStore.ts` の `TableTab` に1フィールド追加:

```ts
appliedFilters: FilterCondition[] // いま表示中の結果を生んだフィルタのスナップショット
```

- `makeTableTab`: `appliedFilters: []`。
- `applyFilters`: 適用する `filters` を `appliedFilters` にスナップショット（イミュータブル更新のため参照保持で十分。後続の編集は別配列を作るので汚染されない）。
- `quickFilter`: 追加後の filters を `appliedFilters` にスナップショット。
- `selectTable` 初期は filters/appliedFilters とも `[]` で非 dirty。

#### dirty 判定（効果ベース・純粋関数）

`src/renderer/src/store/filterBuilder.ts` に純粋関数を2つ追加・export する:

```ts
// 2つの条件集合が「同じ WHERE 効果（結果が変わらない）」かを判定。
// 既存の内部 buildWhere を再利用し、where 文字列と params の一致で比較する。
// id の違い・無効化・空値など結果に影響しない差分は自動的に無視される。
export function sameFilterEffect(
  columns: string[],
  a: FilterCondition[],
  b: FilterCondition[]
): boolean

// 有効かつ実効のある（isUsable な）条件の件数。適用中バッジ用。
export function countUsableFilters(columns: string[], conditions: FilterCondition[]): number
```

`sameFilterEffect` の実装方針:

```ts
const wa = buildWhere(columns, a)
const wb = buildWhere(columns, b)
return wa.where === wb.where && JSON.stringify(wa.params) === JSON.stringify(wb.params)
```

#### FilterBar の表示

- `isDirty = !sameFilterEffect(tab.columns, tab.filters, tab.appliedFilters)`。
- `activeCount = countUsableFilters(tab.columns, tab.appliedFilters)`。
- Apply ボタン: `isDirty` のときアクセント色で強調（クラス付与）。`running` 中は従来どおり無効。dirty でなくても再適用は無害なので押下自体は可能（強調のみ切替）。
- 状態テキスト:
  - `isDirty`: 「未適用の変更（Apply で反映）」
  - `!isDirty && activeCount > 0`: 「フィルタ {activeCount} 件 適用中」
  - それ以外（条件なし）: 表示なし（既存の空状態文言を維持）
- SQL プレビュー行に「適用中:」/「未適用:」のラベルを前置する。

### 3.4 データフロー要点

- quick filter・複製・バー編集・Apply・Clear はすべて最終的に `runTable(recount:true)`（複製は適用しないので除く）を通り、`appliedFilters` は常に「いま表示中の結果を生んだフィルタ」を指す。
- dirty 判定・件数計算はレンダラ内の純粋計算のみ。追加 IPC・追加クエリなし。

## 4. エラーハンドリング

- quick filter の即適用は既存 `runTable` のエラー処理を踏襲（失敗時 `tab.error` をセットし `running:false`）。新規の失敗経路はない。
- `confirmDiscard` により未コミットのセル編集は quick filter 前に確認される（破棄キャンセル時は何もしない）。
- dirty 計算はクエリに触れない純粋計算のため失敗しない。

## 5. テスト

- **`filterBuilder.test.ts` 追加（DB不要・純粋関数）**:
  - `sameFilterEffect`:
    - id だけ異なる同内容 → true
    - 無効化された条件の有無（実効ゼロ）→ true
    - 空値の条件追加（isUsable=false）→ true
    - 値の変更・演算子の変更・列の変更 → false
    - ホワイトリスト外の列を含む差分は無視（その列条件は効果ゼロ）
  - `countUsableFilters`:
    - 有効＋実効のある条件のみ計数
    - 無効・空値・未知列・is_null系の扱いを検証（is_null/is_not_null は値なしでも実効ありとして計数）
- **手動確認**: セル右クリックメニュー（NULL/非NULL の出し分け、編集可否での行操作併置、SQL タブで非表示）、quick filter の即適用、複製ボタン、Apply 強調と状態テキスト、プレビューのラベル。

## 6. 既知の制約（v1 で許容）

- quick filter の値はグリッド表示と同じ `String(value)`。日付/時刻列で mysql2 が Date を返す場合、表示文字列が MySQL 比較形式と一致せず `=` が当たらないことがある。バー側で手調整できるため v1 では許容し、必要なら別フェーズで型別整形を検討する（既存フィルタバーも文字列入力前提で同じ制約）。
- 同一列に同内容の条件を複製/追加すると `col = ? AND col = ?` のように冗長になるが、結果は不変で削除も容易なため許容。
- `sameFilterEffect` は WHERE 効果のみを見るため、結果に影響しない編集（空/無効条件の追加など）は「未適用」と見なさない。これは「Apply しても結果が変わらない」状態を dirty にしない意図的な挙動。

## 7. 変更ファイル

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/renderer/src/store/filterBuilder.ts` | 変更 | `sameFilterEffect` / `countUsableFilters` を追加（export） |
| `src/renderer/src/store/filterBuilder.test.ts` | 変更 | 上記2関数のユニットテスト |
| `src/renderer/src/store/useAppStore.ts` | 変更 | `TableTab.appliedFilters`、`duplicateFilter`/`quickFilter`、applyFilters のスナップショット |
| `src/renderer/src/workspace/FilterBar.tsx` | 変更 | 複製ボタン・適用状態テキスト・Apply 強調・プレビューラベル |
| `src/renderer/src/workspace/FilterBar.module.css` | 変更 | 複製ボタン・状態テキスト・dirty Apply のスタイル |
| `src/renderer/src/workspace/ResultsGrid.tsx` | 変更 | セル右クリック統合メニュー・quick filter 呼び出し |
| `src/renderer/src/workspace/ResultsGrid.module.css` | 変更 | 必要に応じて区切り線等（既存 ctxMenu スタイル流用） |

IPC・メイン・preload・`src/shared/types.ts` は無変更。
