# ウィンドウクローズ時に接続一覧へ戻る 設計

作成日: 2026-06-08

## 背景

接続中はテーブル一覧画面（`WorkspaceShell`）が表示される。`App.tsx` は `status === 'connected'` のとき `WorkspaceShell`、それ以外は `HomeScreen`（接続一覧）を表示する。

現状、テーブル一覧画面で macOS ウィンドウ左上の閉じるボタン（信号機の赤ボタン）を押すと**ウィンドウが破棄される**。`window-all-closed` は darwin では `quit` しないが、ウィンドウが消えるためユーザーには「アプリが閉じた」ように見える。

サイドバー下部には既に「← 接続一覧」ボタン（`disconnect()`）があり、接続一覧へ戻れる。ユーザーは、ウィンドウの閉じるボタンを押したときも同様に**アプリを終了せず接続一覧へ戻ってほしい**と希望している。

## スコープ

対象は **接続中（テーブル一覧表示中）のウィンドウクローズ操作のみ**。

| 状態 | 閉じるボタンの挙動 | 変更 |
|---|---|---|
| 接続中（`isConnected() === true`） | ウィンドウを閉じず、接続一覧へ戻る | **追加する** |
| 接続一覧画面（`isConnected() === false`） | 従来どおりウィンドウを閉じる | 変更なし |

これにより「閉じるボタン2回で終了」（1回目＝接続一覧へ戻る、2回目＝ウィンドウを閉じる）という2段階の挙動になる。

## 設計

接続中かどうかの判定は main（`ConnectionManager.isConnected()`）で行い、未コミット変更の確認とナビゲーションはレンダラで行う。両者を IPC で繋ぐ。

### 1. ウィンドウ `close` の横取り（`src/main/index.ts`）

`createWindow` に `manager: ConnectionManager` を渡し、`close` イベントを横取りする。
Cmd+Q などの明示的な終了は `before-quit` フラグ（`isQuitting`）で区別し、妨げない。

```ts
// 明示的なアプリ終了（Cmd+Q / quit ロール）中かどうか。quit も close を経由するため区別する。
let isQuitting = false
app.on('before-quit', () => {
  isQuitting = true
})

function createWindow(manager: ConnectionManager): void {
  const win = new BrowserWindow({ /* 既存設定 */ })

  win.on('close', (e) => {
    // 接続中に閉じるボタンを押したらウィンドウを閉じる代わりに接続一覧へ戻す。
    // 接続一覧画面（未接続）や明示的な終了（isQuitting）ではそのまま閉じる。
    if (!isQuitting && manager.isConnected()) {
      e.preventDefault()
      win.webContents.send('app:return-to-connections')
    }
  })

  // 既存の ready-to-show / load 処理
}
```

- 判定は `manager.isConnected()` のみ。プラットフォーム非依存（Windows/Linux でも接続中は接続一覧へ戻る）。
- `e.preventDefault()` でウィンドウ破棄を止め、レンダラへ `app:return-to-connections` を送る。
- **Cmd+Q / メニューの Quit は `before-quit` で `isQuitting=true` になるため `preventDefault` せず通常終了する**（接続中でも終了できる）。

### 2. preload にリスナーを追加（`src/preload/index.ts`）

`api` に `onReturnToConnections` を追加。`ipcRenderer.on` を登録し、解除関数を返す（React のクリーンアップ用）。

```ts
onReturnToConnections: (cb: () => void): (() => void) => {
  const handler = (): void => cb()
  ipcRenderer.on('app:return-to-connections', handler)
  return () => ipcRenderer.removeListener('app:return-to-connections', handler)
}
```

### 3. レンダラ型定義の追記（`src/renderer/src/env.d.ts`）

`window.api` 型に `onReturnToConnections: (cb: () => void) => () => void` を追記する（`env.d.ts` は preload の API 形を手書きで複製しているため）。

### 4. ストアに `returnToConnections` アクションを追加（`src/renderer/src/store/useAppStore.ts`）

全タブの未コミット変更を確認し、問題なければ `disconnect()` を呼ぶ。

```ts
async returnToConnections() {
  // 接続中でなければ何もしない（多重発火・競合対策）
  if (get().status !== 'connected') return
  const hasChanges = get().tabs.some((t) => hasUncommittedChanges(t))
  if (hasChanges && !window.confirm('未コミットの変更があります。破棄して接続一覧に戻りますか？')) {
    return
  }
  await get().disconnect()
}
```

- `hasUncommittedChanges`（既存・全タブに適用可、`SqlTab` は常に `false`）を全タブに対して `some` で確認。
- キャンセル時は何もしない＝接続中のまま、変更も保持。ウィンドウも開いたまま（main 側で `preventDefault` 済み）。
- 確認 OK or 変更なし → `disconnect()` で `status: 'idle'`（→ `HomeScreen`）＋ DB プールを閉じる。`isConnected()` が `false` になるので、次に閉じるボタンを押すとウィンドウが閉じる。
- `AppState` インターフェースに `returnToConnections: () => Promise<void>` を追加。

### 5. App でリスナーを購読（`src/renderer/src/App.tsx`）

マウント時に `window.api.onReturnToConnections` を購読し、アンマウントで解除する。

```ts
useEffect(() => {
  const off = window.api.onReturnToConnections(() => {
    void useAppStore.getState().returnToConnections()
  })
  return off
}, [])
```

- `App` は常時マウントされているため、購読は1回でよい。
- ハンドラ内でストアの最新状態を使うため `useAppStore.getState()` で参照する（クロージャ固着回避）。

## エラーハンドリング

- `manager.isConnected()` が `false` のとき main は `preventDefault` せず、ウィンドウは通常どおり閉じる。
- レンダラ側で `status !== 'connected'` のときは早期 return（接続一覧画面で何らかの理由でシグナルを受けても無害）。
- `window.confirm` は同期 API。`disconnect()` の `await` 中に追加の close 操作が来ても、`status` が `'idle'` になれば main 側は次回 `preventDefault` しない。

## テスト

- 確認ロジックの中核は既存 `hasUncommittedChanges`（`helpers.test.ts` でテスト済み）。`returnToConnections` 本体は `window.confirm` / IPC に依存するため、`useAppStore.ts` の既存方針（直接のユニットテストを持たない）に合わせ、ユニットテスト対象外とする。
- 既存テスト（型チェック・vitest）が引き続き通ることを確認する。

## 手動確認

1. 接続 → テーブルを開く → ウィンドウの閉じるボタン → 接続一覧に戻る（アプリは終了しない）。
2. 接続一覧画面で閉じるボタン → ウィンドウが閉じる。
3. セル編集など未コミット変更がある状態で閉じるボタン → 確認ダイアログ。キャンセルでテーブル一覧に留まる／OK で接続一覧へ戻る。
4. 接続中に Cmd+Q（またはメニューの Quit）→ 接続一覧へ戻らずアプリが終了する。

## 非スコープ

- 「保存して戻る / 破棄して戻る / キャンセル」の3択カスタムモーダル（YAGNI。`window.confirm` の2択で十分）。
- 接続一覧画面での閉じる挙動の変更（darwin での dock 常駐など既存挙動はそのまま）。
- サイドバーの「← 接続一覧」ボタンへの確認追加（今回のウィンドウ閉じ経路のみ確認を挟む）。
