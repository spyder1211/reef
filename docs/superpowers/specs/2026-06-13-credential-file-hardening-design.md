# 認証情報・ファイルのハードニング（S2 + S4）設計

> 作成日: 2026-06-13 / ステータス: 設計承認済み（実装計画待ち）/ 対象バージョン: v0.3.0
> 関連: `docs/superpowers/2026-06-13-v0.3-improvement-proposals.md`（S2・S4）

## 1. 背景と問題

v0.3 改善提案の Tier1 から、小粒な認証情報・ファイルの安全強化2点をまとめて対応する。

### S2: safeStorage 不可時の空文字サイレント破棄
`src/main/connection/createProfileStore.ts:33-35`:
```ts
encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) return '' // 例外も警告も出さず空文字
  return safeStorage.encryptString(plain).toString('base64')
}
```
暗号化が利用不可（Linux で keyring 無し等）の場合:
- パスワードが**無言で破棄**され、ユーザーに暗号化が効いていないことが伝わらない（メモリ `ui-shell-followups` の「safeStorage 注記」未実装）。
- さらに `ProfileStore.save()`（`ProfileStore.ts:47-50`、SSH 秘匿値は 64-65）は「非空シークレットは `encrypt()`」のため、**暗号化不可時に非空パスワードで更新すると既存の暗号文を `''` で上書きして消失**させ得る。

配布対象は macOS（Keychain がほぼ常に利用可）のためエッジケースだが、堅牢性とユーザーへの可視化のため対応する。

### S4: 認証情報・履歴ファイルのパーミッションが OS デフォルト
`createProfileStore.ts:26`（`connections.json`）と `QueryHistoryStore.ts:30`（`query-history.json`）の `writeFileSync` に `mode` 指定がなく、umask 依存で多くの環境で `0644`（他ユーザー読み取り可）。暗号文メタ情報や、SQL 実行履歴（値リテラルを含み得る平文）がマルチユーザー機で他ユーザーに読まれ得る。

## 2. ゴール / 非ゴール

### ゴール
- **S2**: 暗号化不可時はパスワード・SSH 秘匿値を**保存せず**（平文をディスクに残さない）、フォームに注記して可視化する。既存暗号文を上書きで消さない。
- **S4**: `connections.json` / `query-history.json` を `0o600`（所有者のみ読み書き）で永続化する。新規作成・既存ファイルの両方に適用。

### 非ゴール
- 暗号化不可環境向けの「接続時パスワード手入力プロンプト」（macOS では不要。注記で「保存されない」ことを伝えるに留める）。
- 平文フォールバック保存（方針として却下。平文をディスクに残さない）。
- モーダルの Esc/フォーカストラップ等の a11y（別項目 U3）。
- 他の userData ファイルや既存ファイルの一括 chmod 移行（対象2ファイルのみ）。

## 3. 設計

### 3.1 S4: ファイル権限 0o600

**新規** `src/main/util/writeFileSecure.ts`:
```ts
import { writeFileSync, chmodSync } from 'node:fs'

// 所有者のみ読み書き可（0o600）でファイルを書き込む。
// writeFileSync の mode は新規作成時しか効かないため、既存ファイルにも chmodSync で適用する。
export function writeFileSecure(path: string, data: string): void {
  writeFileSync(path, data, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}
```

**変更:**
- `createProfileStore.ts` の `persist`（26行）: `writeFileSync(filePath, JSON.stringify(...), 'utf-8')` → `writeFileSecure(filePath, JSON.stringify({ profiles: doc.profiles, groups: doc.groups }, null, 2))`。
- `QueryHistoryStore.ts` の `persist`（30行）: `writeFileSync(this.filePath, JSON.stringify(this.entries))` → `writeFileSecure(this.filePath, JSON.stringify(this.entries))`。

### 3.2 S2: 暗号化不可時はシークレットを保存せず注記

**`SecretBox` インターフェース拡張**（`ProfileStore.ts:10-13`）に `isAvailable(): boolean` を追加。`createProfileStore.ts` の `secret` で `isAvailable: () => safeStorage.isEncryptionAvailable()` を実装。

**`ProfileStore.save()` のシークレット処理を統一**（`ProfileStore.ts:47-66` を整理）。ヘルパーを導入:
```ts
// 暗号化できない時は平文を書かず既存値を保持する（既存暗号文の上書き消失・平文化を防ぐ）。
const encOrKeep = (plain: string | undefined, existing: string | undefined): string | undefined => {
  if (!plain) return existing                        // 空入力: 既存維持（新規なら undefined）
  if (!this.deps.secret.isAvailable()) return existing // 暗号化不可: 平文を書かず既存維持
  return this.deps.secret.encrypt(plain)
}
```
これを使い:
- `const encryptedPassword = encOrKeep(input.password, prev?.encryptedPassword) ?? ''`（必須 string のため新規＋不可は `''`＝保存されない）
- SSH の `sshPasswordEnc = encOrKeep(input.ssh.password, prev?.sshPasswordEnc)`、`sshPassphraseEnc = encOrKeep(input.ssh.passphrase, prev?.sshPassphraseEnc)`（`input.ssh !== undefined` のブロック内）。

挙動: 暗号化不可時、**新規＝空（保存されない）／更新＝既存維持（消えない）**。平文は一切ディスクに書かれない。

**新規 IPC** `connections:isEncryptionAvailable`（`registerConnectionHandlers.ts`）→ `safeStorage.isEncryptionAvailable()` を返す（`ApiResult<boolean>`）。`safeStorage` を electron から import。

**preload**（`preload/index.ts`）の `connections` に `isEncryptionAvailable: (): Promise<ApiResult<boolean>> => ipcRenderer.invoke('connections:isEncryptionAvailable')` を追加。`env.d.ts` の `Window.api.connections` 型にも追加。

**`ConnectionFormModal.tsx`**: マウント時に `window.api.connections.isEncryptionAvailable()` を呼び、結果を local state に保持。`false`（明示的に取得できた場合のみ）のとき Password Field（145-152行）の直下に注記を表示:
> この環境では認証情報（パスワード・SSH 秘匿値）を暗号化保存できないため、保存されません。

注記のスタイルは既存の警告系（例: SSH 周辺やフォームの注記）に合わせた控えめな文言ブロック。

## 4. テスト方針

純粋ロジック中心に TDD（MySQL 不要）。

- **`writeFileSecure.test.ts`（新規）**: tmp ディレクトリに書き、`statSync(path).mode & 0o777` が `0o600` であること。既存ファイル（先に 0o644 で作成）を上書きしても `0o600` になること。
- **`ProfileStore.test.ts`（追記）**: 既存の fake `SecretBox` に `isAvailable` を追加。
  - `isAvailable() === false` のとき、新規プロファイル＋非空パスワード → `list()`/再ロードで接続に使う暗号文が空（= 保存されない）。
  - `isAvailable() === false` で既存プロファイルを非空パスワードで更新 → 既存の暗号文が維持される（`getConnectConfig` で復号して元のパスワードが得られる）。
  - `isAvailable() === true` の既存テストが壊れないこと。
- **IPC + フォーム注記**: electron/React 依存のため `npm run typecheck` と手動 GUI で確認（テスト基盤外）。
- `QueryHistoryStore.test.ts` は `writeFileSecure` 経由でも既存テスト（add/list/persist/clear）が通ること。必要なら mode アサーションを1件追加。

## 5. 受け入れ基準

1. `connections.json` と `query-history.json` が `0o600` で作成・更新される（既存ファイルも次回保存で 0o600 になる）。
2. 暗号化不可環境で、パスワード付き新規接続を保存しても**平文がディスクに残らない**（暗号文フィールドは空）。
3. 暗号化不可環境で既存接続を非空パスワードで更新しても、**既存の暗号化パスワードが消えない**。
4. 暗号化不可環境では接続フォームに「暗号化保存できない」旨の注記が出る。利用可能な通常環境（macOS）では注記は出ず、保存・接続は従来どおり。
5. `npm run typecheck` と `npm test` が PASS。新規ユニットテスト（writeFileSecure・ProfileStore の暗号化不可ケース）が追加されている。

## 6. 影響を受けるファイル

**新規:**
- `src/main/util/writeFileSecure.ts` + `writeFileSecure.test.ts`

**変更:**
- `src/main/connection/createProfileStore.ts`（persist を writeFileSecure に / secret に isAvailable 追加）
- `src/main/history/QueryHistoryStore.ts`（persist を writeFileSecure に）
- `src/main/connection/ProfileStore.ts`（SecretBox に isAvailable / save の encOrKeep 統一）+ `ProfileStore.test.ts`
- `src/main/ipc/registerConnectionHandlers.ts`（connections:isEncryptionAvailable ハンドラ）
- `src/preload/index.ts` + `src/renderer/src/env.d.ts`（isEncryptionAvailable bridge と型）
- `src/renderer/src/home/ConnectionFormModal.tsx`（注記表示）

## 7. 未確定事項（実装計画で確定する）
- 注記の最終文言と CSS クラス（既存のフォーム注記スタイルに合わせる）。
- `isEncryptionAvailable` 取得失敗時（`ok:false`）の扱い: 注記を出さない（= 利用可能とみなす）方針を既定とする。
