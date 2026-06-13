# Electron ハードニング（S3）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レンダラ侵害に対する多層防御として、本番ビルドに strict CSP を付与し、`sandbox: true` 化し、外部への遷移・新規ウィンドウ生成を禁止する。

**Architecture:** すべて `src/main/index.ts` への追加。本番のみ `session.onHeadersReceived` で CSP ヘッダを付与（dev は Vite HMR 維持のため付けない）。`webPreferences.sandbox` を true に。`app.on('web-contents-created')` で `will-navigate` と `setWindowOpenHandler` をロックダウン。

**Tech Stack:** Electron 31（session / shell / webContents）/ TypeScript。

**設計:** `docs/superpowers/specs/2026-06-13-electron-hardening-design.md`

**注記（テスト境界）:** 本機能は Electron ランタイム設定であり**ユニットテスト不可**。各タスクは `npm run typecheck` で確認し、実挙動は **Task 4 の手動 dev/prod 起動**で検証する（このリポジトリの `src/main/index.ts` に既存テストは無い）。検証コマンドは `npm run typecheck`、UI は `npm run dev` と `npm run build && npm run preview`。

---

## ファイル構成

**変更:**
- `src/main/index.ts` — CSP(onHeadersReceived) / sandbox:true / web-contents-created の lockdown / import 追加
- `src/renderer/index.html` — CSP コメントの更新（任意・cosmetic）

---

# Task 1: `sandbox: true` 化

**Files:**
- Modify: `src/main/index.ts`（webPreferences、現状 38-43 行付近）

- [ ] **Step 1: webPreferences を変更**

`createWindow` の `webPreferences` を次に変更（`sandbox: false` → `true`。他は不変）:
```ts
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: BrowserWindow を sandbox: true に変更"
```

---

# Task 2: 本番ビルドのみ strict CSP

**Files:**
- Modify: `src/main/index.ts`（import 行 / module スコープ定数 / `app.whenReady` 内）

- [ ] **Step 1: import に session を追加**

`src/main/index.ts:1` の electron import に `session` を追加（`shell` は Task 3 で追加するため、ここでは session のみ）:
```ts
import { app, BrowserWindow, Menu, session } from 'electron'
```

- [ ] **Step 2: CSP 定数を module スコープに追加**

import 群の直後（`app.setName('Table++')` の前あたり）に追加:
```ts
// 本番ビルドのレンダラに付与する Content-Security-Policy。
// script-src 'self'（unsafe-inline/eval なし）が要。style は React/CodeMirror の
// インラインスタイル用に 'unsafe-inline' を許可（スタイル注入は script より低リスク）。
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'"
```

- [ ] **Step 3: whenReady 内で本番のみ CSP を登録**

`app.whenReady().then(() => {` の本体先頭（`const manager = ...` の前）に追加:
```ts
  // dev（Vite HMR）では CSP を付けない。本番ビルド（loadFile）でのみ strict CSP を付与する。
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] }
      })
    })
  }
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: 本番ビルドに strict CSP を付与する"
```

---

# Task 3: ナビゲーション / 新規ウィンドウの lockdown

**Files:**
- Modify: `src/main/index.ts`（import 行 / module スコープに app.on 追加）
- Modify: `src/renderer/index.html`（コメント更新・任意）

- [ ] **Step 1: import に shell を追加**

`src/main/index.ts:1` の electron import に `shell` を追加（Task 2 で `session` は追加済み）:
```ts
import { app, BrowserWindow, Menu, session, shell } from 'electron'
```

- [ ] **Step 2: web-contents-created の lockdown を追加**

既存の `app.on('before-quit', ...)`（現状 29-31 行付近）の近く、module スコープに追加:
```ts
// レンダラからのアプリ外遷移・新規ウィンドウ生成を禁止する（防御的。現状アプリは遷移も window.open もしない）。
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const sameApp = (devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!sameApp) event.preventDefault() // アプリ外への遷移を禁止
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url) // 外部 URL は既定ブラウザで開く
    return { action: 'deny' } // アプリ内に新規ウィンドウは開かない
  })
})
```

- [ ] **Step 3: index.html のコメントを更新（任意）**

`src/renderer/index.html:6` のコメントを更新:
```html
    <!-- CSP は main 側（本番ビルドのみ session.onHeadersReceived）で付与する -->
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/renderer/index.html
git commit -m "feat: 外部遷移・新規ウィンドウを禁止しCSPコメントを更新"
```

---

# Task 4: 検証（手動 dev/prod）と PR

**Files:** なし（検証とリリース作業）

- [ ] **Step 1: typecheck + 既存テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（既存テストが壊れていないこと。本機能に新規ユニットテストは無い）

- [ ] **Step 2: 手動 dev 検証（`npm run dev`）**

`sandbox: true` 下で全機能が動くことを確認:
- [ ] 接続一覧の表示、接続、テーブル一覧の表示。
- [ ] テーブルグリッドの表示・ソート・ページング・フィルタ・セル編集。
- [ ] SQL エディタ（CodeMirror）のハイライト・補完・実行。
- [ ] 各モーダル（接続フォーム / SQL import）の開閉。
- [ ] ダークモード追従、コンテキストメニュー。
- [ ] dev では CSP が付かず HMR が正常（コンソールに CSP エラーが出ない）。

- [ ] **Step 3: 手動 prod 検証（`npm run build && npm run preview`）**

- [ ] 白画面にならず、Step 2 の全機能が動く。
- [ ] DevTools コンソールに CSP 違反（`Refused to load/execute ...`）が出ない。
- [ ] CSP が実際に効いていること（onHeadersReceived が file:// 文書ロードで適用されること）を確認。確認方法: DevTools の Network で document レスポンスに `Content-Security-Policy` ヘッダがある、または `script-src` 違反を意図的に起こすと拒否される。
- [ ] **フォールバック**: もし prod で CSP ヘッダが適用されない（onHeadersReceived が file:// で効かない）場合は、ここで停止して報告すること。設計 §4/§7 の代替（`<meta http-equiv="Content-Security-Policy">` を Vite の `transformIndexHtml`（`apply: 'build'`）でビルド時のみ注入）へ切り替える。

- [ ] **Step 4: 受け入れ基準の確認**

spec §5 の受け入れ基準 1〜5 を満たすことを確認する。

- [ ] **Step 5: PR 作成**

```bash
git push -u origin feat/electron-hardening
gh pr create --title "feat: Electron ハードニング（本番CSP / sandbox / ナビ lockdown）" --body "$(cat <<'EOF'
## 概要
レンダラ侵害に対する多層防御（v0.3 の S3）。すべて src/main/index.ts。
- 本番ビルドのみ strict CSP（session.onHeadersReceived、script-src 'self'）。dev は HMR 維持のため付与なし。
- sandbox: false → true（preload は ipcRenderer のみ依存で安全）。
- will-navigate でアプリ外遷移を禁止、setWindowOpenHandler で新規ウィンドウ deny・外部 URL は既定ブラウザで開く。
- contextIsolation: true / nodeIntegration: false は維持。

## テスト
- 自動: typecheck PASS / 既存 test 壊れなし（本機能は Electron 設定でユニットテスト不可）
- 手動: dev（sandbox:true で全機能動作・HMR 正常）/ prod（build & preview で CSP 適用・白画面なし・CSP 違反なし）

設計: docs/superpowers/specs/2026-06-13-electron-hardening-design.md
計画: docs/superpowers/plans/2026-06-13-electron-hardening.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 自己レビュー結果（spec との突き合わせ）

- spec §3.1 本番CSP(onHeadersReceived) → Task 2 ✅
- spec §3.2 sandbox:true → Task 1 ✅
- spec §3.3 ナビ lockdown → Task 3 ✅
- spec §3.4 index.html コメント → Task 3 Step 3 ✅
- spec §4 検証（typecheck + 手動 dev/prod、meta フォールバック）→ Task 4 ✅
- spec §5 受け入れ基準 → Task 4 ✅

**型/識別子の一貫性:** electron import は Task 2 で `session`、Task 3 で `shell` を順に追加（最終 `{ app, BrowserWindow, Menu, session, shell }`）。`CSP` 定数は Task 2 で定義し Task 2 で使用。`isDev`/`ELECTRON_RENDERER_URL` の判定は既存 `createWindow` と同じ環境変数。`web-contents-created` は module スコープの app.on（既存 `before-quit`/`window-all-closed` と同じ場所）。

**順序の注意:** Task 2 で import に `session` のみ追加 → Task 3 で `shell` を追加。Task を順に実施すれば import 行が二度更新される（中間状態でも typecheck は通る）。サブエージェントが Task をまたぐ場合は最終的に両方含まれることを確認すること。
