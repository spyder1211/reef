# 認証情報・ファイルのハードニング（S2 + S4）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 認証情報・履歴ファイルを `0o600` で永続化し（S4）、safeStorage で暗号化できない環境ではシークレットを保存せずフォームに注記する（S2、既存暗号文の上書き消失も防ぐ）。

**Architecture:** S4 は共有ヘルパー `writeFileSecure`（mode 0o600 + 既存ファイル chmod）に集約して2つの persist で使う。S2 は `SecretBox` に `isAvailable()` を足し、`ProfileStore.save()` を `encOrKeep` ヘルパーで統一して「暗号化不可な非空シークレットは平文を書かず既存維持」とし、`isEncryptionAvailable` を IPC で renderer に公開してフォームに注記する。

**Tech Stack:** Electron（safeStorage / ipcMain）/ TypeScript / Vitest（node 環境・MySQL 不要）/ Node fs（mode・chmod）。

**設計:** `docs/superpowers/specs/2026-06-13-credential-file-hardening-design.md`

**検証コマンド:** 各タスクで `npm test -- <名前>`、最後に `npm run typecheck && npm test`。GUI は `npm run dev`。

**注記（テスト境界）:** テスト可能な純粋ロジック（`writeFileSecure`・`ProfileStore.save` の暗号化不可ケース・`QueryHistoryStore` の mode）は TDD で検証する。electron/React 依存の配線（IPC・preload・env.d.ts・フォーム注記）は `npm run typecheck` と Task 6 の手動 GUI チェックで検証する。

---

## ファイル構成

**新規:**
- `src/main/util/writeFileSecure.ts`(+test) — 0o600 でファイルを書く共有ヘルパー

**変更:**
- `src/main/connection/createProfileStore.ts` — persist を writeFileSecure に / secret に isAvailable 追加
- `src/main/history/QueryHistoryStore.ts`(+test) — persist を writeFileSecure に
- `src/main/connection/ProfileStore.ts`(+test) — SecretBox に isAvailable / save を encOrKeep で統一
- `src/main/ipc/registerConnectionHandlers.ts` — `connections:isEncryptionAvailable` ハンドラ
- `src/preload/index.ts` + `src/renderer/src/env.d.ts` — isEncryptionAvailable bridge と型
- `src/renderer/src/home/ConnectionFormModal.tsx`(+module.css) — 注記表示

---

# Task 1: `writeFileSecure` ヘルパー（TDD）

**Files:**
- Create: `src/main/util/writeFileSecure.ts`
- Test: `src/main/util/writeFileSecure.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/util/writeFileSecure.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSecure } from './writeFileSecure'

describe('writeFileSecure', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfs-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('新規ファイルを 0o600 で書く', () => {
    const p = join(dir, 'a.json')
    writeFileSecure(p, '{"x":1}')
    expect(existsSync(p)).toBe(true)
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })

  it('既存ファイル（0o644）を上書きしても 0o600 になる', () => {
    const p = join(dir, 'b.json')
    writeFileSync(p, 'old', { mode: 0o644 })
    writeFileSecure(p, 'new')
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })

  it('内容が正しく書かれる', () => {
    const p = join(dir, 'c.json')
    writeFileSecure(p, 'hello')
    expect(readFileSync(p, 'utf-8')).toBe('hello')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- writeFileSecure`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`src/main/util/writeFileSecure.ts`:
```ts
import { writeFileSync, chmodSync } from 'node:fs'

// 所有者のみ読み書き可（0o600）でファイルを書き込む。
// writeFileSync の mode は新規作成時しか効かないため、既存ファイルにも chmodSync で適用する。
export function writeFileSecure(path: string, data: string): void {
  writeFileSync(path, data, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- writeFileSecure`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/util/writeFileSecure.ts src/main/util/writeFileSecure.test.ts
git commit -m "feat: 0o600 でファイルを書く writeFileSecure ヘルパーを追加"
```

---

# Task 2: persist を writeFileSecure に切り替える

**Files:**
- Modify: `src/main/connection/createProfileStore.ts`
- Modify: `src/main/history/QueryHistoryStore.ts`
- Test: `src/main/history/QueryHistoryStore.test.ts`（mode アサーション追記）

- [ ] **Step 1: `createProfileStore.ts` の persist を置換**

import を変更（`writeFileSync` を外し `writeFileSecure` を足す。`readFileSync`/`existsSync`/`mkdirSync` は残す）:
```ts
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { writeFileSecure } from '../util/writeFileSecure'
```
`persist`（現状 24-31行）を置換:
```ts
    persist(doc: StoredDoc): void {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSecure(
        filePath,
        JSON.stringify({ profiles: doc.profiles, groups: doc.groups }, null, 2)
      )
    },
```

- [ ] **Step 2: `QueryHistoryStore.ts` の persist を置換**

import を変更（`writeFileSync` を外し `writeFileSecure` を足す）:
```ts
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileSecure } from '../util/writeFileSecure'
import type { QueryHistoryEntry } from '../../shared/types'
```
`persist`（現状 29-31行）を置換:
```ts
  private persist(): void {
    writeFileSecure(this.filePath, JSON.stringify(this.entries))
  }
```

- [ ] **Step 3: `QueryHistoryStore.test.ts` に mode アサーションを追記**

既存ファイル冒頭の import に `statSync` を足し（`import { mkdtempSync, rmSync, statSync } from 'node:fs'` のように既存 import へ合流）、`join` が未 import なら足す。新しいテストを追記:
```ts
import { statSync } from 'node:fs'
import { join } from 'node:path'

it('履歴ファイルを 0o600 で書く', () => {
  const store = new QueryHistoryStore(dir)
  store.add({ sql: 'SELECT 1', durationMs: 5, ok: true })
  const p = join(dir, 'query-history.json')
  expect(statSync(p).mode & 0o777).toBe(0o600)
})
```
注: 既存テストの `dir`（mkdtemp）とファイル名 `query-history.json` を使う。import の重複は1行にまとめること。

- [ ] **Step 4: typecheck + テスト**

Run: `npm run typecheck && npm test -- QueryHistoryStore`
Expected: PASS（既存 + 新規 mode テスト）。`npm test` 全体も PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/createProfileStore.ts src/main/history/QueryHistoryStore.ts src/main/history/QueryHistoryStore.test.ts
git commit -m "feat: connections.json/query-history.json を 0o600 で永続化する"
```

---

# Task 3: `SecretBox.isAvailable` と `ProfileStore.save` の統一（TDD）

**Files:**
- Modify: `src/main/connection/ProfileStore.ts`
- Test: `src/main/connection/ProfileStore.test.ts`

- [ ] **Step 1: 既存 fake に isAvailable を足し、失敗する新規テストを書く**

`ProfileStore.test.ts` の既存 fake SecretBox **2箇所**に `isAvailable: () => true` を追加する:
- `freshDeps()`（12行付近）: `secret: { isAvailable: () => true, encrypt: (s) => \`enc:${s}\`, decrypt: (s) => s.replace(/^enc:/, '') },`
- 「save / move / delete は既存の groups を保持する」内の inline deps（124行付近）も同様に `isAvailable: () => true` を追加。

新規テストを `describe('ProfileStore', ...)` の末尾に追記:
```ts
  it('暗号化不可なら新規の非空パスワードは保存しない（平文を残さない）', () => {
    let doc: StoredDoc = { profiles: [], groups: [] }
    const deps: StoreDeps = {
      load: () => doc,
      persist: (d) => { doc = d },
      secret: { isAvailable: () => false, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
      genId: () => 'id-1'
    }
    const store = new ProfileStore(deps)
    const a = store.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'secret' })
    // 暗号化できないので保存されず、接続時は空パスワード。平文 'secret' はディスクに残らない。
    expect(store.getConnectConfig(a.id).password).toBe('')
    expect(doc.profiles[0].encryptedPassword).toBe('')
  })

  it('暗号化不可でも既存の暗号化パスワードを上書きで消さない', () => {
    let available = true
    let doc: StoredDoc = { profiles: [], groups: [] }
    const deps: StoreDeps = {
      load: () => doc,
      persist: (d) => { doc = d },
      secret: { isAvailable: () => available, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.replace(/^enc:/, '') },
      genId: () => 'id-1'
    }
    const store = new ProfileStore(deps)
    const a = store.save({ name: 'a', tag: 'local', host: 'h', port: 3306, user: 'u', password: 'secret' })
    available = false
    // 暗号化不可の状態で非空パスワードで更新しても既存暗号文は維持される
    store.save({ id: a.id, name: 'a2', tag: 'staging', host: 'h', port: 3306, user: 'u', password: 'newpw' })
    expect(store.getConnectConfig(a.id).password).toBe('secret')
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- ProfileStore`
Expected: FAIL（`isAvailable` が型に無い / save が暗号化不可を考慮していない）

- [ ] **Step 3: `SecretBox` に isAvailable を追加し、save を encOrKeep で統一**

`ProfileStore.ts` の `SecretBox` インターフェース（10-13行）に追加:
```ts
export interface SecretBox {
  isAvailable(): boolean
  encrypt(plain: string): string
  decrypt(cipher: string): string
}
```
`save()`（41-85行）を次の本体に置換:
```ts
  save(input: ConnectionProfileInput): ConnectionProfile {
    const doc = this.deps.load()
    const profiles = doc.profiles
    const id = input.id ?? this.deps.genId()
    const idx = profiles.findIndex((p) => p.id === id)
    const prev = idx >= 0 ? profiles[idx] : undefined

    // 暗号化できない時は平文を書かず既存値を保持する（既存暗号文の上書き消失・平文化を防ぐ）。
    const encOrKeep = (plain: string | undefined, existing: string | undefined): string | undefined => {
      if (!plain) return existing
      if (!this.deps.secret.isAvailable()) return existing
      return this.deps.secret.encrypt(plain)
    }

    const encryptedPassword = encOrKeep(input.password, prev?.encryptedPassword) ?? ''
    // groupId は input に明示された場合のみ反映し、無ければ既存値を保持する。
    const groupId = input.groupId !== undefined ? input.groupId : prev?.groupId
    // SSH 設定: 公開部のみ ssh に格納し、秘匿値は暗号化して別フィールドへ。input に ssh が無ければ既存値を保持。
    let ssh: SshSettingsPublic | undefined = prev?.ssh
    let sshPasswordEnc: string | undefined = prev?.sshPasswordEnc
    let sshPassphraseEnc: string | undefined = prev?.sshPassphraseEnc
    if (input.ssh !== undefined) {
      const { password: sshPw, passphrase: sshPp, ...pub } = input.ssh
      ssh = pub
      sshPasswordEnc = encOrKeep(sshPw, prev?.sshPasswordEnc)
      sshPassphraseEnc = encOrKeep(sshPp, prev?.sshPassphraseEnc)
    }
    const stored: StoredProfile = {
      id,
      name: input.name,
      tag: input.tag,
      host: input.host,
      port: input.port,
      user: input.user,
      database: input.database,
      groupId,
      ssh,
      encryptedPassword,
      sshPasswordEnc,
      sshPassphraseEnc
    }
    if (idx >= 0) profiles[idx] = stored
    else profiles.push(stored)
    this.deps.persist(doc)
    return stripSecret(stored)
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- ProfileStore`
Expected: PASS（既存 + 新規2件。既存の「空なら維持」「入力で差し替え」「SSH 空なら維持」も緑のまま）

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/ProfileStore.ts src/main/connection/ProfileStore.test.ts
git commit -m "feat: 暗号化不可時にシークレットを保存せず既存値を維持する"
```

---

# Task 4: createProfileStore の isAvailable と isEncryptionAvailable IPC

**Files:**
- Modify: `src/main/connection/createProfileStore.ts`
- Modify: `src/main/ipc/registerConnectionHandlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: createProfileStore の secret に isAvailable を実装**

`createProfileStore.ts` の `secret`（33-41行付近）に `isAvailable` を追加:
```ts
    secret: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt(plain: string): string {
        if (!safeStorage.isEncryptionAvailable()) return ''
        return safeStorage.encryptString(plain).toString('base64')
      },
      decrypt(cipher: string): string {
        if (!cipher) return ''
        return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
      }
    },
```

- [ ] **Step 2: IPC ハンドラを追加**

`registerConnectionHandlers.ts` の import に `safeStorage` を追加:
```ts
import { ipcMain, BrowserWindow, safeStorage } from 'electron'
```
`connections:connect` ハンドラの後（または他のハンドラ群の末尾）に追加:
```ts
  ipcMain.handle('connections:isEncryptionAvailable', async (): Promise<ApiResult<boolean>> => {
    return { ok: true, data: safeStorage.isEncryptionAvailable() }
  })
```

- [ ] **Step 3: preload と env.d.ts に bridge/型を追加**

`src/preload/index.ts` の `connections` オブジェクト（`move` の後）に追加（末尾要素のためカンマに注意）:
```ts
    move: (profileId: string, groupId: string | null): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('connections:move', profileId, groupId),
    isEncryptionAvailable: (): Promise<ApiResult<boolean>> =>
      ipcRenderer.invoke('connections:isEncryptionAvailable')
```
`src/renderer/src/env.d.ts` の `connections`（43-50行）に型を追加（`move` の後）:
```ts
        move: (profileId: string, groupId: string | null) => Promise<ApiResult<null>>
        isEncryptionAvailable: () => Promise<ApiResult<boolean>>
```

- [ ] **Step 4: typecheck + テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（既存テストが壊れていないこと）

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/createProfileStore.ts src/main/ipc/registerConnectionHandlers.ts src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: isEncryptionAvailable を IPC で公開し createProfileStore に実装"
```

---

# Task 5: 接続フォームに注記を表示

**Files:**
- Modify: `src/renderer/src/home/ConnectionFormModal.tsx`
- Modify: `src/renderer/src/home/ConnectionFormModal.module.css`

- [ ] **Step 1: availability を取得する state と effect を追加**

`ConnectionFormModal.tsx` の React import に `useEffect` を追加:
```ts
import { useState, useEffect, type ReactNode } from 'react'
```
コンポーネント本体の他の `useState` 群の近く（例 `testState` の後、42行付近）に追加:
```ts
  // safeStorage が使えない環境（暗号化不可）では認証情報を保存できない旨を注記する。
  // 既定 true = 注記を出さない（取得できた場合のみ false で注記）。
  const [encAvailable, setEncAvailable] = useState(true)
  useEffect(() => {
    void window.api.connections.isEncryptionAvailable().then((res) => {
      if (res.ok) setEncAvailable(res.data)
    })
  }, [])
```

- [ ] **Step 2: Password Field の直下に注記を表示**

`ConnectionFormModal.tsx` の Password の `<Field>`（145-152行）の `</Field>` 直後に追加:
```tsx
        <Field label="Password">
          <input
            className={styles.input}
            type="password"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>

        {!encAvailable && (
          <div className={styles.encWarn}>
            この環境では認証情報（パスワード・SSH 秘匿値）を暗号化保存できないため、保存されません。
          </div>
        )}
```

- [ ] **Step 3: CSS クラスを追加**

`ConnectionFormModal.module.css` の末尾に追加（既存のテーマ変数に合わせる。色変数が無い場合は直値で可）:
```css
.encWarn {
  margin: -2px 0 8px;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--danger, #d93025);
  background: var(--panel-bg, #f6f6f6);
  border: 1px solid var(--border, #e0e0e0);
  border-radius: 4px;
}
```
注: 既存 `*.module.css` の変数名（`--danger` 等。`theme.css` 参照）に合わせること。存在しない変数があれば直値にフォールバック。

- [ ] **Step 4: typecheck + 動作確認**

Run: `npm run typecheck && npm test`
Expected: PASS。

Run: `npm run dev` → 通常の macOS 環境では注記は出ず、フォームが従来どおり動くこと（暗号化不可環境を再現できないため、注記の出現は手動検証の対象）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/home/ConnectionFormModal.tsx src/renderer/src/home/ConnectionFormModal.module.css
git commit -m "feat: 暗号化保存できない環境で接続フォームに注記を表示"
```

---

# Task 6: 全体検証・手動確認・PR

**Files:** なし（検証とリリース作業）

- [ ] **Step 1: 全体の typecheck + テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（新規: writeFileSecure / QueryHistoryStore mode / ProfileStore 暗号化不可ケース）

- [ ] **Step 2: 手動確認（`npm run dev`）**

- [ ] 通常環境で接続プロファイルを新規保存→接続でき、注記は出ない（従来どおり）。
- [ ] 保存後、`~/Library/Application Support/Table++/connections.json` のパーミッションが `600` であること（`ls -l` で `-rw-------`）。クエリを実行して `query-history.json` も `600` であること。
- [ ] （任意・暗号化不可を再現できる環境があれば）注記が表示され、保存後に connections.json へ平文パスワードが入っていないこと。

- [ ] **Step 3: 受け入れ基準の確認**

spec §5 の受け入れ基準 1〜5 を満たすことを確認する。

- [ ] **Step 4: PR 作成**

```bash
git push -u origin feat/credential-file-hardening
gh pr create --title "feat: 認証情報・ファイルのハードニング（0o600 / safeStorage 注記）" --body "$(cat <<'EOF'
## 概要
- S4: connections.json / query-history.json を 0o600 で永続化（writeFileSecure ヘルパー）
- S2: safeStorage で暗号化できない環境ではシークレットを保存せずフォームに注記。既存暗号文の上書き消失も防止

## テスト
- 自動: writeFileSecure（mode）/ QueryHistoryStore（mode）/ ProfileStore（暗号化不可ケース）。typecheck + test PASS
- 手動: connections.json/query-history.json が 600 / 通常環境で注記なし・従来どおり保存接続

設計: docs/superpowers/specs/2026-06-13-credential-file-hardening-design.md
計画: docs/superpowers/plans/2026-06-13-credential-file-hardening.md
EOF
)"
```

---

## 自己レビュー結果（spec との突き合わせ）

- spec §3.1 writeFileSecure → Task 1 ✅ / persist 適用 → Task 2 ✅
- spec §3.2 SecretBox.isAvailable + save encOrKeep → Task 3 ✅
- spec §3.2 createProfileStore isAvailable + IPC + preload + env.d.ts → Task 4 ✅
- spec §3.2 ConnectionFormModal 注記 → Task 5 ✅
- spec §4 テスト方針（writeFileSecure / ProfileStore 不可ケース / QueryHistoryStore mode）→ Task 1・2・3 ✅
- spec §5 受け入れ基準 → Task 6 手動確認 ✅

**型の一貫性:** `SecretBox.isAvailable(): boolean` を ProfileStore（interface）/ createProfileStore（実装）/ test fake の全箇所で一致。`encOrKeep(plain?, existing?) => string | undefined`、`encryptedPassword = ... ?? ''`。IPC `connections:isEncryptionAvailable` を main / preload / env.d.ts で `Promise<ApiResult<boolean>>` に統一。

**精緻化:** `save()` は `prev` を冒頭で定義する形に整理（encOrKeep が prev を使うため）。groupId は `prev?.groupId` 参照に簡約（挙動不変）。encrypt() の `isEncryptionAvailable` フォールバックは encOrKeep が isAvailable を先に見るため save 経路からは不到達になるが、防御的に残す。
