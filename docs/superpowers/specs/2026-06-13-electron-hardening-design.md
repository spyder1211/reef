# Electron ハードニング（S3: CSP + sandbox + ナビ lockdown）設計

> 作成日: 2026-06-13 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.3.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（S3）

## 1. 背景と問題

Table++ は DB クライアントであり、「信頼できない DB の内容」を画面に表示する前提のため、レンダラ侵害に対する多層防御が重要。現状（`src/main/index.ts`）には次の穴がある（監査で確認済み）:

- **CSP（Content-Security-Policy）が一切ない**。`src/renderer/index.html:6` にコメントがあるだけで、dev/prod とも未設定。将来リッチ表示・Markdown・エラー HTML 経路でインジェクションが生まれた場合、最後の防壁がない。
- **`sandbox: false`**（`index.ts:42`）。preload が完全な Node 権限で動くため、レンダラ侵害がメインプロセス権限へ昇格しやすい。preload は `contextBridge`/`ipcRenderer` のみ依存（Node API 不使用）なので **`sandbox: true` 化は安全に可能**。
- **ナビゲーション/新規ウィンドウの制御が皆無**。`will-navigate` も `setWindowOpenHandler` も未設定。レンダラ内で外部 URL 遷移や `window.open` が起きた場合、アプリのフレーム内で任意サイトが開ける（フィッシング/トークン窃取の足場）。

良い点（維持する）: `contextIsolation: true` / `nodeIntegration: false` は正しく設定済み。

## 2. ゴール / 非ゴール

### ゴール
- 本番ビルドに strict な CSP を付与する（dev は Vite HMR を壊さないため付与しない）。
- `sandbox: true` に変更する。
- 外部への遷移・新規ウィンドウ生成を禁止し、外部 URL は既定ブラウザで開く。

### 非ゴール
- dev への CSP 適用（dev はローカルのみで脅威が低く、HMR と衝突するため付けない）。
- Electron Fuses（`RunAsNode` 無効化等、監査の S8）。
- 本番メニューからの DevTools 除去（監査の S7）。
- 既存の `contextIsolation`/`nodeIntegration` の変更（現状維持）。

## 3. 設計

すべて `src/main/index.ts` への追加。

### 3.1 CSP（本番ビルドのみ・onHeadersReceived）
`app.whenReady()` 内、ウィンドウ生成前に default session へ登録する。dev 判定は既存コードと同じ `process.env.ELECTRON_RENDERER_URL` の有無を使う。
```ts
import { app, BrowserWindow, Menu, session, shell } from 'electron'

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'"

// app.whenReady().then(() => { の中、createWindow より前
const isDev = !!process.env['ELECTRON_RENDERER_URL']
if (!isDev) {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] }
    })
  })
}
```
- `script-src 'self'`（`unsafe-inline`/`unsafe-eval` なし）が最重要の防御。
- `style-src` は React のインラインスタイル・CodeMirror 用に `'unsafe-inline'` を許可（スタイル注入は script 注入より低リスク）。
- `connect-src 'self'`: レンダラから外部への fetch/WebSocket を禁止（DB 通信は main 経由で renderer は IPC のみ）。

### 3.2 `sandbox: true`
`createWindow` の `webPreferences`（`index.ts:38-43`）で `sandbox: false` → `sandbox: true`。`contextIsolation: true` / `nodeIntegration: false` はそのまま。

### 3.3 ナビゲーション / 新規ウィンドウの lockdown
`app.whenReady()` 内（または module スコープ）で全 web-contents に適用:
```ts
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const sameApp = (devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!sameApp) event.preventDefault() // アプリ外への遷移を禁止
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url) // 外部 URL は既定ブラウザで
    return { action: 'deny' } // アプリ内に新規ウィンドウは開かない
  })
})
```
現状アプリは遷移も `window.open` もしないため通常動作への影響はなく、純粋に防御的。

### 3.4 index.html のコメント整理
`src/renderer/index.html:6` の「CSP は後続プランで追加する」コメントを、CSP は main 側（本番のみ onHeadersReceived）で付与する旨に更新（任意・cosmetic）。

## 4. 検証

本機能は Electron ランタイムの設定であり**ユニットテスト不可**。検証は typecheck と手動の dev/prod 起動で行う。

- `npm run typecheck` PASS。`npm test` が（無関係に）壊れていないこと。
- **手動 dev**（`npm run dev`）: `sandbox: true` 下で全機能が動く — 接続/一覧、テーブルグリッド、SQL エディタ（CodeMirror の補完・ハイライト）、各モーダル、ダークモード、コンテキストメニュー、ダンプ入出力。CSP は dev では付かない（HMR 正常）。
- **手動 prod**（`npm run build && npm run preview`）: 白画面にならず全機能が動く。DevTools コンソールに CSP 違反（`Refused to ...`）が出ないこと。CSP が実際に効いていること（onHeadersReceived が file:// 文書ロードで適用されること）を確認する。
  - もし file:// で onHeadersReceived が効かない場合は、`<meta http-equiv="Content-Security-Policy">` を Vite ビルド時のみ注入する方式へ切り替える（実装計画の代替手順）。

## 5. 受け入れ基準

1. 本番ビルド（`npm run build` → preview/パッケージ）で CSP が適用され、`script-src 'self'` 等が効く。dev では CSP が付かず HMR が動く。
2. `sandbox: true` に変更しても、dev/prod とも全機能が従来どおり動作する。
3. レンダラから外部 URL へ遷移しようとしても遷移しない。`window.open`/外部リンクは新規ウィンドウを開かず、http(s) は既定ブラウザで開く。
4. `contextIsolation: true` / `nodeIntegration: false` が維持されている。
5. `npm run typecheck` PASS。既存テストが壊れていない。

## 6. 影響を受けるファイル

**変更:**
- `src/main/index.ts`（CSP onHeadersReceived / sandbox:true / web-contents-created の lockdown / import に session・shell 追加）
- `src/renderer/index.html`（CSP コメントの更新・任意）

## 7. 未確定事項（実装計画で確定する）
- onHeadersReceived が本番 file:// ロードで CSP を適用できるかは手動 prod 検証で確定する。効かない場合は `<meta>` 注入方式へ切り替える（§4 のフォールバック）。
- `connect-src 'self'` がレンダラの想定通信（無いはず）を阻害しないかを prod 検証で確認。問題があれば該当ディレクティブのみ緩める。
