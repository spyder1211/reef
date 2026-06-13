# 本番ガード main 側強制 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** renderer のみに存在する本番ガードを main プロセスへ移し、書き込み・破壊系の全境界（`db:query`/`db:queryScript`/`db:applyChanges`・`sqlImport:start`・File メニューの dump export）で main が確認を強制してバイパスを塞ぐ。

**Architecture:** main にモジュールシングルトン `productionContext`（接続時に tag を捕捉・切断時にクリア）を置く。純粋関数 `classifyStatement`/`classifyScript` で SQL をティア分類し、注入可能な `confirmProductionAction`（2段階 native ダイアログ）で確認、薄いヘルパー `productionGuard` が各ハンドラから呼ばれる。キャンセルは `{ code: 'CANCELLED' }` で返し renderer は静かに中止する。

**Tech Stack:** Electron 31（`dialog.showMessageBox` / `BrowserWindow`）/ TypeScript / Vitest（node 環境・MySQL 不要）。既存 `SqlStatementSplitter` を分類で再利用。

**設計:** `docs/superpowers/specs/2026-06-13-production-guard-main-enforcement-design.md`

**検証コマンド:** 各タスクで `npm test -- <名前>`、最後に `npm run typecheck && npm test`。GUI は `npm run dev`。

**注記（テスト境界）:** ロジックは純粋関数（Task 1〜3, 9）に集約し TDD で厚くテストする。IPC ハンドラ／メニュー／electron 依存の glue（Task 4〜8）と renderer の分岐（Task 10）は、本リポジトリの既存慣行どおり `npm run typecheck` と Task 11 の手動 GUI チェックリストで検証する（既存コードベースに IPC ハンドラの単体テストは無く、electron をモックする土台も無いため）。

---

## ファイル構成

**新規（main）:**
- `src/main/connection/productionContext.ts` — 現在接続の production 状態を保持するモジュールシングルトン
- `src/main/connection/productionContext.test.ts`
- `src/main/guard/classifyStatement.ts` — SQL のティア分類（純粋関数）
- `src/main/guard/classifyStatement.test.ts`
- `src/main/guard/confirmProductionAction.ts` — 2段階 native 確認ダイアログ（表示は注入可能）
- `src/main/guard/confirmProductionAction.test.ts`
- `src/main/guard/productionGuard.ts` — 各ハンドラ用の薄いガードヘルパー

**変更（main）:**
- `src/main/ipc/registerConnectionHandlers.ts` — connect 成功時に context を設定
- `src/main/ipc/registerDbHandlers.ts` — connect/disconnect で context、query/queryScript/applyChanges にガード
- `src/main/import/registerImportHandlers.ts` — sqlImport:start にガード
- `src/main/menu.ts` — exportSqlDump にガード

**変更（renderer）:**
- `src/renderer/src/store/helpers.ts` — `isCancelled` 追加
- `src/renderer/src/store/helpers.test.ts` — `isCancelled` のテスト
- `src/renderer/src/store/useAppStore.ts` — runSql/commitEdits/truncateTable/dropTable の CANCELLED 分岐
- `src/renderer/src/workspace/SqlImportModal.tsx` — import の CANCELLED 分岐

---

# Phase A: 純粋ロジック（main・TDD）

## Task 1: `productionContext`（接続状態のシングルトン）

**Files:**
- Create: `src/main/connection/productionContext.ts`
- Test: `src/main/connection/productionContext.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/connection/productionContext.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setProductionContext,
  clearProductionContext,
  getProductionContext,
  isProductionConnection
} from './productionContext'

describe('productionContext', () => {
  beforeEach(() => clearProductionContext())

  it('初期状態は null・非 production', () => {
    expect(getProductionContext()).toBeNull()
    expect(isProductionConnection()).toBe(false)
  })

  it('production をセットすると isProductionConnection が true', () => {
    setProductionContext({ tag: 'production', name: '本番DB' })
    expect(isProductionConnection()).toBe(true)
    expect(getProductionContext()).toEqual({ tag: 'production', name: '本番DB' })
  })

  it('production 以外のタグは false', () => {
    setProductionContext({ tag: 'staging', name: 'stg' })
    expect(isProductionConnection()).toBe(false)
  })

  it('clear で null・非 production に戻る', () => {
    setProductionContext({ tag: 'production', name: '本番DB' })
    clearProductionContext()
    expect(getProductionContext()).toBeNull()
    expect(isProductionConnection()).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- productionContext`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`src/main/connection/productionContext.ts`:
```ts
import type { ConnectionTag } from '../../shared/types'

// 現在の接続が production かどうかを main プロセス全体で共有するモジュールシングルトン。
// src/main/import/importState.ts と同じ「プロセス内に1つだけ存在するクロスカット状態」方式。
interface ProductionContextValue {
  tag: ConnectionTag
  name: string
}

let current: ProductionContextValue | null = null

export function setProductionContext(value: ProductionContextValue): void {
  current = value
}

export function clearProductionContext(): void {
  current = null
}

export function getProductionContext(): ProductionContextValue | null {
  return current
}

// renderer の isProductionProfile と同じ基準（tag === 'production'）。
export function isProductionConnection(): boolean {
  return current?.tag === 'production'
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- productionContext`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/main/connection/productionContext.ts src/main/connection/productionContext.test.ts
git commit -m "feat: 本番接続状態を保持する productionContext を追加"
```

## Task 2: `classifyStatement` / `classifyScript`（SQL ティア分類）

**Files:**
- Create: `src/main/guard/classifyStatement.ts`
- Test: `src/main/guard/classifyStatement.test.ts`

既存 `src/main/import/sqlStatementSplitter.ts` の `SqlStatementSplitter` を再利用する（`ConnectionManager.queryScript` と同じ `[...splitter.push(sql), ...splitter.end()]` の使い方）。

- [ ] **Step 1: 失敗するテストを書く**

`src/main/guard/classifyStatement.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { classifyStatement, classifyScript } from './classifyStatement'

describe('classifyStatement', () => {
  it('SELECT/SHOW/EXPLAIN/DESCRIBE/USE/SET は readonly', () => {
    expect(classifyStatement('SELECT * FROM users')).toBe('readonly')
    expect(classifyStatement('SHOW TABLES')).toBe('readonly')
    expect(classifyStatement('EXPLAIN SELECT 1')).toBe('readonly')
    expect(classifyStatement('DESCRIBE users')).toBe('readonly')
    expect(classifyStatement('USE mydb')).toBe('readonly')
    expect(classifyStatement('SET @x = 1')).toBe('readonly')
  })
  it('INSERT/UPDATE/DELETE/ALTER/CREATE/CALL は write', () => {
    expect(classifyStatement('INSERT INTO t VALUES (1)')).toBe('write')
    expect(classifyStatement('UPDATE t SET a=1')).toBe('write')
    expect(classifyStatement('DELETE FROM t')).toBe('write')
    expect(classifyStatement('ALTER TABLE t ADD c INT')).toBe('write')
    expect(classifyStatement('CREATE TABLE t (id INT)')).toBe('write')
    expect(classifyStatement('CALL my_proc()')).toBe('write')
  })
  it('DROP/TRUNCATE は catastrophic', () => {
    expect(classifyStatement('DROP TABLE t')).toBe('catastrophic')
    expect(classifyStatement('TRUNCATE TABLE t')).toBe('catastrophic')
    expect(classifyStatement('DROP DATABASE d')).toBe('catastrophic')
  })
  it('先頭の空白・小文字・開き括弧を吸収する', () => {
    expect(classifyStatement('  drop table t')).toBe('catastrophic')
    expect(classifyStatement('(SELECT 1)')).toBe('readonly')
  })
  it('空文字は readonly', () => {
    expect(classifyStatement('')).toBe('readonly')
  })
})

describe('classifyScript', () => {
  it('複数文の最大ティアを返す（SELECT + DROP → catastrophic）', () => {
    expect(classifyScript('SELECT 1; DROP TABLE t;')).toBe('catastrophic')
  })
  it('SELECT + UPDATE → write', () => {
    expect(classifyScript('SELECT 1; UPDATE t SET a=1;')).toBe('write')
  })
  it('SELECT のみ → readonly', () => {
    expect(classifyScript('SELECT 1; SELECT 2;')).toBe('readonly')
  })
  it('空文字・空白のみ → readonly', () => {
    expect(classifyScript('   ')).toBe('readonly')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- classifyStatement`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`src/main/guard/classifyStatement.ts`:
```ts
import { SqlStatementSplitter } from '../import/sqlStatementSplitter'

export type GuardTier = 'readonly' | 'write' | 'catastrophic'

// 先頭キーワードが DROP/TRUNCATE → catastrophic、書き込み系 → write、それ以外 → readonly。
const CATASTROPHIC = new Set(['DROP', 'TRUNCATE'])
const WRITE = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'ALTER', 'CREATE',
  'RENAME', 'GRANT', 'REVOKE', 'CALL', 'LOAD'
])

// 1文の先頭キーワードを大文字で取り出す。先頭の空白・開き括弧は除去。
function leadingKeyword(sql: string): string {
  const m = sql.trim().replace(/^\(+\s*/, '').match(/^[A-Za-z_]+/)
  return m ? m[0].toUpperCase() : ''
}

export function classifyStatement(sql: string): GuardTier {
  const kw = leadingKeyword(sql)
  if (CATASTROPHIC.has(kw)) return 'catastrophic'
  if (WRITE.has(kw)) return 'write'
  return 'readonly'
}

const RANK: Record<GuardTier, number> = { readonly: 0, write: 1, catastrophic: 2 }

// スクリプト全体を文単位に分割し、最大ティアを返す。空/コメントのみは readonly。
export function classifyScript(sql: string): GuardTier {
  const splitter = new SqlStatementSplitter()
  const statements = [...splitter.push(sql), ...splitter.end()]
  let tier: GuardTier = 'readonly'
  for (const stmt of statements) {
    const t = classifyStatement(stmt)
    if (RANK[t] > RANK[tier]) tier = t
  }
  return tier
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- classifyStatement`
Expected: PASS（全 test）

> 補足: 万一 `SqlStatementSplitter` の `push`/`end` のシグネチャが異なる場合は `src/main/import/sqlStatementSplitter.ts` を読み、`ConnectionManager.queryScript`（`src/main/connection/ConnectionManager.ts:46-58`）と同じ呼び方に合わせること。

- [ ] **Step 5: Commit**

```bash
git add src/main/guard/classifyStatement.ts src/main/guard/classifyStatement.test.ts
git commit -m "feat: SQL をティア分類する classifyStatement/classifyScript を追加"
```

## Task 3: `confirmProductionAction`（2段階 native 確認）

**Files:**
- Create: `src/main/guard/confirmProductionAction.ts`
- Test: `src/main/guard/confirmProductionAction.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/guard/confirmProductionAction.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { buildConfirmOptions, confirmProductionAction } from './confirmProductionAction'

describe('buildConfirmOptions', () => {
  it('write は OK/キャンセルでチェックボックスなし', () => {
    const o = buildConfirmOptions('write', '変更の適用', '本番DB')
    expect(o.buttons).toEqual(['キャンセル', '実行する'])
    expect(o.defaultId).toBe(0)
    expect(o.cancelId).toBe(0)
    expect(o.checkboxLabel).toBeUndefined()
    expect(o.message).toContain('本番DB')
    expect(o.message).toContain('変更の適用')
  })
  it('catastrophic はチェックボックス付き（既定 OFF）', () => {
    const o = buildConfirmOptions('catastrophic', 'DROP', '本番DB')
    expect(o.checkboxLabel).toBe('本番だと理解した上で実行する')
    expect(o.checkboxChecked).toBe(false)
    expect(o.cancelId).toBe(0)
  })
})

describe('confirmProductionAction', () => {
  it('write: 実行ボタンで true', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'write', 'op', 'db', { showMessageBox })
    ).resolves.toBe(true)
  })
  it('write: キャンセルで false', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'write', 'op', 'db', { showMessageBox })
    ).resolves.toBe(false)
  })
  it('catastrophic: チェック無しの実行は false', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'catastrophic', 'op', 'db', { showMessageBox })
    ).resolves.toBe(false)
  })
  it('catastrophic: チェック有りの実行は true', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: true })
    await expect(
      confirmProductionAction(null, 'catastrophic', 'op', 'db', { showMessageBox })
    ).resolves.toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- confirmProductionAction`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装**

`src/main/guard/confirmProductionAction.ts`:
```ts
import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'

export type ConfirmTier = 'write' | 'catastrophic'

// ダイアログの options を組み立てる純粋関数（表示はしない）。
export function buildConfirmOptions(
  tier: ConfirmTier,
  opLabel: string,
  connName: string
): MessageBoxOptions {
  const base: MessageBoxOptions = {
    type: 'warning',
    buttons: ['キャンセル', '実行する'],
    defaultId: 0,
    cancelId: 0,
    title: '本番環境での操作',
    message: `本番環境（${connName}）で「${opLabel}」を実行しようとしています。`,
    detail: '本番データに直接影響します。よろしいですか？'
  }
  if (tier === 'catastrophic') {
    return {
      ...base,
      detail: '本番データを破壊・置換する可能性があります。十分に確認してください。',
      checkboxLabel: '本番だと理解した上で実行する',
      checkboxChecked: false
    }
  }
  return base
}

// 実際に確認ダイアログを表示し、続行可否を返す。showMessageBox は注入可能（テスト用）。
export async function confirmProductionAction(
  win: BrowserWindow | null,
  tier: ConfirmTier,
  opLabel: string,
  connName: string,
  deps: { showMessageBox?: typeof dialog.showMessageBox } = {}
): Promise<boolean> {
  const show = deps.showMessageBox ?? dialog.showMessageBox
  const options = buildConfirmOptions(tier, opLabel, connName)
  const result = win ? await show(win, options) : await show(options)
  if (result.response !== 1) return false // 「実行する」以外は中止
  if (tier === 'catastrophic' && !result.checkboxChecked) return false // チェック必須
  return true
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- confirmProductionAction`
Expected: PASS（全 test）

- [ ] **Step 5: Commit**

```bash
git add src/main/guard/confirmProductionAction.ts src/main/guard/confirmProductionAction.test.ts
git commit -m "feat: 2段階の本番確認ダイアログ confirmProductionAction を追加"
```

## Task 4: `productionGuard`（ハンドラ用ヘルパー）

**Files:**
- Create: `src/main/guard/productionGuard.ts`

このファイルは electron（`BrowserWindow`）依存の薄い glue で、ロジックは Task 2/3 のテスト済み関数に委譲する。単体テストは付けず `npm run typecheck` で検証する（実挙動は Task 11 の手動チェックリストで確認）。

- [ ] **Step 1: 実装**

`src/main/guard/productionGuard.ts`:
```ts
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getProductionContext, isProductionConnection } from '../connection/productionContext'
import { classifyScript } from './classifyStatement'
import { confirmProductionAction, type ConfirmTier } from './confirmProductionAction'

// 共通: production なら確認、非 production なら即 true（素通り）。
async function guard(
  win: BrowserWindow | null,
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  if (!isProductionConnection()) return true
  const name = getProductionContext()?.name ?? '本番環境'
  return confirmProductionAction(win, tier, opLabel, name)
}

// IPC ハンドラ用: 固定ティアで確認。
export async function guardProductionTier(
  e: IpcMainInvokeEvent,
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  return guard(BrowserWindow.fromWebContents(e.sender), tier, opLabel)
}

// IPC ハンドラ用: SQL 文字列を分類してから確認（readonly は即 true）。
export async function guardProductionSql(
  e: IpcMainInvokeEvent,
  sql: string,
  opLabel: string
): Promise<boolean> {
  if (!isProductionConnection()) return true
  const tier = classifyScript(sql)
  if (tier === 'readonly') return true
  return guard(BrowserWindow.fromWebContents(e.sender), tier, opLabel)
}

// メニュー用: フォーカス中ウィンドウを親に確認。
export async function guardProductionMenu(
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  return guard(BrowserWindow.getFocusedWindow(), tier, opLabel)
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/main/guard/productionGuard.ts
git commit -m "feat: 各ハンドラ用の本番ガードヘルパー productionGuard を追加"
```

---

# Phase B: main 統合

## Task 5: 接続/切断で context を設定・クリア

**Files:**
- Modify: `src/main/ipc/registerConnectionHandlers.ts`
- Modify: `src/main/ipc/registerDbHandlers.ts`

- [ ] **Step 1: connect 成功時に context を設定**

`src/main/ipc/registerConnectionHandlers.ts` の import に追加:
```ts
import { setProductionContext } from '../connection/productionContext'
```

`connections:connect` ハンドラ（現状 62-72 行）を次に置き換える:
```ts
  ipcMain.handle('connections:connect', async (e, id: string): Promise<ApiResult<null>> => {
    try {
      const config = store.getConnectConfig(id)
      await connectWithTunnel(manager, config, tunnel)
      // 接続中の production 判定のため、プロファイルの tag/name を main 側に保持する。
      const meta = store.list().find((p) => p.id === id)
      if (meta) setProductionContext({ tag: meta.tag, name: meta.name })
      // 接続成功でテーブル一覧画面へ遷移する。作業領域いっぱいにウィンドウを最大化する。
      BrowserWindow.fromWebContents(e.sender)?.maximize()
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
```

- [ ] **Step 2: テスト接続/切断で context をクリア**

`src/main/ipc/registerDbHandlers.ts` の import に追加:
```ts
import { clearProductionContext } from '../connection/productionContext'
```

`db:connect` ハンドラ（現状 21-35 行）の成功直後に `clearProductionContext()` を追加（テスト接続はタグ不明＝非 production 扱い）:
```ts
      try {
        await connectWithTunnel(manager, config, tunnel)
        clearProductionContext() // テスト接続はタグ不明のため非 production 扱い
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
```

`db:disconnect` ハンドラ（現状 63-71 行）の `closeTunnel` の後に `clearProductionContext()` を追加:
```ts
  ipcMain.handle('db:disconnect', async (): Promise<ApiResult<null>> => {
    try {
      await manager.disconnect()
      await closeTunnel(tunnel) // DB 切断後に SSH トンネルも閉じる（接続一覧へ戻る時も同経路）
      clearProductionContext()
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
```

- [ ] **Step 3: typecheck + 既存テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（既存テストが壊れていないこと）

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/registerConnectionHandlers.ts src/main/ipc/registerDbHandlers.ts
git commit -m "feat: 接続時に本番 tag を捕捉し切断時にクリアする"
```

## Task 6: `db:query` / `db:queryScript` / `db:applyChanges` にガード

**Files:**
- Modify: `src/main/ipc/registerDbHandlers.ts`

- [ ] **Step 1: import とキャンセル定数を追加**

`registerDbHandlers.ts` の import に追加:
```ts
import { guardProductionSql, guardProductionTier } from '../guard/productionGuard'
```

`registerDbHandlers` 関数本体の先頭（最初の `ipcMain.handle` の前）に共通のキャンセル戻り値を定義:
```ts
  // 本番ガードでキャンセルされた時の戻り値（renderer は code==='CANCELLED' を静かに扱う）。
  const CANCELLED = { ok: false as const, error: { code: 'CANCELLED', message: '' } }
```

- [ ] **Step 2: `db:query` にガード**

`db:query` ハンドラ（現状 37-46 行）を置き換える（第1引数を `_e` → `e` に）:
```ts
  ipcMain.handle(
    'db:query',
    async (e, sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      try {
        return { ok: true, data: await manager.query(sql, params) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )
```

- [ ] **Step 3: `db:queryScript` にガード**

`db:queryScript` ハンドラ（現状 48-61 行）を置き換える（キャンセル時は履歴に記録しない）:
```ts
  ipcMain.handle(
    'db:queryScript',
    async (e, sql: string): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      try {
        const data = await manager.queryScript(sql)
        history.add({ sql, durationMs: data.durationMs, ok: true })
        return { ok: true, data }
      } catch (err) {
        const error = normalizeDbError(err)
        history.add({ sql, durationMs: 0, ok: false, errorMessage: error.message })
        return { ok: false, error }
      }
    }
  )
```

- [ ] **Step 4: `db:applyChanges` にガード**

`db:applyChanges` ハンドラ（現状 122-131 行）を置き換える（第1引数を `_e` → `e`、ティアは write 固定）:
```ts
  ipcMain.handle(
    'db:applyChanges',
    async (e, statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> => {
      if (!(await guardProductionTier(e, 'write', '変更の適用（コミット）'))) return CANCELLED
      try {
        return { ok: true, data: await manager.applyChanges(statements) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )
```

- [ ] **Step 5: typecheck + 既存テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/registerDbHandlers.ts
git commit -m "feat: SQL 実行・変更適用の IPC に本番ガードを追加"
```

## Task 7: `sqlImport:start` にガード

**Files:**
- Modify: `src/main/import/registerImportHandlers.ts`

- [ ] **Step 1: import を追加**

`registerImportHandlers.ts` の import に追加:
```ts
import { guardProductionTier } from '../guard/productionGuard'
```

- [ ] **Step 2: consume の前にガードを入れる**

`sqlImport:start` ハンドラ（現状 12 行〜）の冒頭、`consumePendingImport()` の**前**にガードを追加（キャンセル時に pending を温存し再選択を不要にする）:
```ts
  ipcMain.handle('sqlImport:start', async (e): Promise<ApiResult<ImportSummary>> => {
    // 本番では実行前に強い確認（pending を消費する前にガードする）。
    if (!(await guardProductionTier(e, 'catastrophic', 'SQL ダンプの import / restore'))) {
      return { ok: false, error: { code: 'CANCELLED', message: '' } }
    }
    const filePath = consumePendingImport()
    if (!filePath) {
      return {
        ok: false,
        error: { code: 'NO_PENDING_IMPORT', message: 'インポート対象のファイルが選択されていません' }
      }
    }
    // …以降は現状のまま（isImporting チェック・setImporting・importSqlDump 実行）…
```

- [ ] **Step 3: typecheck + 既存テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/import/registerImportHandlers.ts
git commit -m "feat: SQL import/restore に本番ガード（壊滅的確認）を追加"
```

## Task 8: メニューの dump export にガード

**Files:**
- Modify: `src/main/menu.ts`

- [ ] **Step 1: import を追加**

`menu.ts` の import に追加:
```ts
import { guardProductionMenu } from './guard/productionGuard'
```

- [ ] **Step 2: `exportSqlDump` にガード**

`exportSqlDump`（現状 11 行〜）の `isConnected()` チェックの直後にガードを追加:
```ts
async function exportSqlDump(manager: ConnectionManager): Promise<void> {
  if (!manager.isConnected()) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'DB に接続していません',
      detail: '接続してから SQL ダンプを実行してください。'
    })
    return
  }
  // 本番ではエクスポート（全行のファイル化）前に強い確認。
  if (!(await guardProductionMenu('catastrophic', 'SQL ダンプのエクスポート'))) return

  // …以降は現状のまま（DB 名取得・保存ダイアログ・ストリーム書き込み）…
```

> import（`importSqlDump`）側のメニューには追加しない。実行強制は Task 7 の `sqlImport:start` に集約し、二重確認を避ける。

- [ ] **Step 3: typecheck + 既存テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts
git commit -m "feat: SQL ダンプのエクスポートに本番ガードを追加"
```

---

# Phase C: renderer の CANCELLED 処理

## Task 9: `isCancelled` ヘルパー（TDD）

**Files:**
- Modify: `src/renderer/src/store/helpers.ts`
- Test: `src/renderer/src/store/helpers.test.ts`

- [ ] **Step 1: 失敗するテストを追記**

`src/renderer/src/store/helpers.test.ts` の末尾に追記（既存の import 群に `isCancelled` を足す）:
```ts
import { isCancelled } from './helpers'

describe('isCancelled', () => {
  it('CANCELLED の失敗結果は true', () => {
    expect(isCancelled({ ok: false, error: { code: 'CANCELLED', message: '' } })).toBe(true)
  })
  it('他のエラーコードは false', () => {
    expect(isCancelled({ ok: false, error: { code: 'DB_ERROR', message: 'x' } })).toBe(false)
  })
  it('成功結果は false', () => {
    expect(isCancelled({ ok: true, data: null })).toBe(false)
  })
})
```

> 既存の `helpers.test.ts` に `import { describe, it, expect } from 'vitest'` と他ヘルパーの import が既にあるはず。`isCancelled` をその import 行に加えるか、上記のように個別 import を足す（重複 import はまとめること）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test -- helpers`
Expected: FAIL（`isCancelled` 未定義）

- [ ] **Step 3: 実装**

`src/renderer/src/store/helpers.ts` の**先頭**に型 import を追加（このファイルは現状 import 無しなので新規行）:
```ts
import type { ApiResult } from '../../../shared/types'
```

`src/renderer/src/store/helpers.ts` の末尾に追加:
```ts
// IPC 結果が本番ガードのキャンセル（CANCELLED）かどうか。
// 失敗だがエラー表示せず静かに中止するために使う。
// 引数は ApiResult<unknown>（成功 {ok:true;data} もそのまま渡せる）。
export function isCancelled(res: ApiResult<unknown>): boolean {
  return !res.ok && res.error.code === 'CANCELLED'
}
```

> 注: 構造型 `{ ok; error? }` にするとテストの `isCancelled({ ok: true, data: null })` が余剰プロパティチェックで型エラーになるため、`ApiResult<unknown>` を受ける。`!res.ok` で false 分岐に絞り込まれるので `res.error.code` は安全。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- helpers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/helpers.ts src/renderer/src/store/helpers.test.ts
git commit -m "feat: 本番ガードのキャンセル判定 isCancelled を追加"
```

## Task 10: ストア/モーダルで CANCELLED を静かに処理

**Files:**
- Modify: `src/renderer/src/store/useAppStore.ts`
- Modify: `src/renderer/src/workspace/SqlImportModal.tsx`

`runTable`（SELECT+COUNT）と `explainActiveTab`（EXPLAIN）は readonly のみでガード対象外＝CANCELLED にならないため変更不要。

- [ ] **Step 1: useAppStore に `isCancelled` を import**

`src/renderer/src/store/useAppStore.ts` の helpers からの import に `isCancelled` を追加する（既存の `import { ..., hasUncommittedChanges } from './helpers'` 等に合流させる。重複させないこと）。

- [ ] **Step 2: `runSql` に CANCELLED 分岐**

`runSql`（現状 237-257 行）の `queryScript` 呼び出し直後に分岐を挿入:
```ts
  async function runSql(tabId: string, sql: string): Promise<void> {
    setTabRunning(tabId)
    try {
      // SQL エディタは複数文を1回で全実行する（; で分割して逐次実行）。
      const res = await window.api.queryScript(sql)
      if (isCancelled(res)) {
        // 本番ガードでキャンセル: 実行前なので結果は変えず running だけ戻す。
        set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: false } : t)) })
        return
      }
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                running: false,
                result: res.ok ? res.data : null,
                error: res.ok ? null : res.error
              }
            : t
        )
      })
    } catch (err) {
      failTab(tabId, err)
    }
  }
```

- [ ] **Step 3: `commitEdits` に CANCELLED 分岐**

`commitEdits`（現状 814-859 行）の `applyChanges` 呼び出し直後に分岐を挿入（ステージは保持）:
```ts
      setTabRunning(tabId)
      try {
        const res = await window.api.applyChanges(statements)
        if (isCancelled(res)) {
          // 本番ガードでキャンセル: ステージング変更は保持し running だけ戻す。
          patchTableTab(tabId, (t) => ({ ...t, running: false }))
          return
        }
        if (!res.ok) {
          // 失敗時はグリッドを潰さず EditBar にエラー表示。ステージは保持して再試行可能。
          set({
            tabs: get().tabs.map((t) =>
              t.id === tabId && t.kind === 'table'
                ? { ...t, running: false, editError: res.error }
                : t
            )
          })
          return
        }
        patchTableTab(tabId, (t) => ({
          ...t, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndices: [], selectionAnchor: null
        }))
        await runTable(tabId, { recount: true }) // INSERT/DELETE は行数が変わる
      } catch (err) {
        failTab(tabId, err)
      }
```

- [ ] **Step 4: `truncateTable` / `dropTable` に CANCELLED 分岐**

`truncateTable`（現状 583-587 行付近）の `query` 直後を変更:
```ts
        const { sql, params } = buildTruncateStatement(name)
        const res = await window.api.query(sql, params)
        if (isCancelled(res)) return // 本番ガードでキャンセル: 何もしない
        if (!res.ok) {
          window.alert(res.error.message)
          return
        }
```

`dropTable`（現状 620-624 行付近）の `query` 直後を同様に変更:
```ts
        const { sql, params } = buildDropStatement(name)
        const res = await window.api.query(sql, params)
        if (isCancelled(res)) return // 本番ガードでキャンセル: 何もしない
        if (!res.ok) {
          window.alert(res.error.message)
          return
        }
```

- [ ] **Step 5: `SqlImportModal` に CANCELLED 分岐**

`src/renderer/src/workspace/SqlImportModal.tsx` の import に追加:
```ts
import { isCancelled } from '../store/helpers'
```

`handleRun`（現状 39-46 行）を置き換える:
```ts
  async function handleRun(): Promise<void> {
    setPhase('running')
    setProgress({ executedCount: 0, bytesRead: 0, totalBytes: req!.totalBytes })
    const res = await window.api.sqlImport.start()
    if (isCancelled(res)) {
      // 本番ガードでキャンセル: エラー表示せず確認画面へ戻す。
      setPhase('confirm')
      return
    }
    if (res.ok) setSummary(res.data)
    else setFatal(`${res.error.code}: ${res.error.message}`)
    setPhase('result')
  }
```

- [ ] **Step 6: typecheck + 全テスト**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/useAppStore.ts src/renderer/src/workspace/SqlImportModal.tsx
git commit -m "feat: 本番ガードのキャンセルを renderer で静かに処理する"
```

---

# Phase D: 仕上げ

## Task 11: 全体検証・手動 GUI チェック・PR

**Files:** なし（検証とリリース作業）

- [ ] **Step 1: 全体の typecheck + テスト**

Run: `npm run typecheck && npm test`
Expected: PASS（新規ユニットテスト productionContext / classifyStatement / confirmProductionAction / isCancelled を含む）

- [ ] **Step 2: 手動 GUI チェック（`npm run dev`、テスト用 production プロファイルで）**

`docker compose -f docker-compose.test.yml up -d` で MySQL を起動し、tag=`production` の接続プロファイルを作って接続し、以下を確認:

- [ ] SQLタブで `SELECT ...` → 確認は**出ない**。
- [ ] SQLタブで `DELETE FROM ...` / `UPDATE ...` → OK/キャンセルの確認が出る。キャンセルでエラートーストは出ず結果も変わらない。
- [ ] SQLタブで `DROP TABLE ...` / `TRUNCATE TABLE ...` → チェックボックス必須の赤い確認が出る。チェックせず「実行する」では実行されない。
- [ ] テーブル右クリック → DROP/TRUNCATE → 既存 confirm の後に本番チェックボックス確認が出る。
- [ ] セルを編集して ⌘S（コミット）→ OK/キャンセル確認。キャンセルで編集ステージが保持される。
- [ ] 行追加(INSERT)/行削除(DELETE) をコミット → 同様に確認。
- [ ] File → SQLダンプをエクスポート → チェックボックス確認。
- [ ] File → SQLダンプをインポート → ファイル選択 → 確認モーダル「実行する」→ 本番チェックボックス確認。キャンセルで確認画面へ戻る。
- [ ] tag=`staging`/`development`/`local` の接続では上記いずれの追加確認も**出ない**（v0.2.0 と同じ挙動）。
- [ ] 「テスト接続」ボタン（接続フォーム）後に別の非 production へ繋いでも production 扱いにならない。

- [ ] **Step 3: 受け入れ基準の確認**

spec §10 の受け入れ基準 1〜6 をすべて満たすことを確認する。

- [ ] **Step 4: RELEASE_NOTES の更新（任意・v0.3 のまとめ時でも可）**

v0.3 のリリースノートに「本番ガードを main 側で強制（import/restore・dump・破壊的SQL・編集コミットを本番では確認）」を追記する場合はここで。単独 PR なら PR 本文に記載のみでも可。

- [ ] **Step 5: PR 作成**

```bash
git push -u origin feat/production-guard-main
gh pr create --title "feat: 本番ガードを main 側で強制する" --body "$(cat <<'EOF'
## 概要
renderer のみに存在していた本番ガードを main プロセスへ移し、書き込み・破壊系の全境界で確認を強制する（バイパス不可）。

## 変更
- main に productionContext / classifyStatement / confirmProductionAction / productionGuard を追加
- db:query/queryScript/applyChanges・sqlImport:start・menu の dump export にガード
- 確認は2段階（通常書き込み=OK/キャンセル、壊滅的=チェックボックス必須）
- キャンセルは CANCELLED コードで返し renderer は静かに中止

## テスト
- 純粋関数のユニットテスト（context/分類/確認/isCancelled）
- 手動 GUI チェック（production/非 production の両方）

設計: docs/superpowers/specs/2026-06-13-production-guard-main-enforcement-design.md
計画: docs/superpowers/plans/2026-06-13-production-guard-main.md
EOF
)"
```

---

## 自己レビュー結果（spec との突き合わせ）

- spec §5.1 productionContext → Task 1 ✅
- spec §5.2 classifyStatement/Script → Task 2 ✅
- spec §5.3 confirmProductionAction（buildConfirmOptions 純粋関数 + 注入可能）→ Task 3 ✅
- spec §5.4 productionGuard → Task 4 ✅
- spec §6.1 connect で context 設定 → Task 5 ✅
- spec §6.2 db:connect/disconnect クリア・query/queryScript/applyChanges ガード → Task 5・6 ✅
- spec §6.3 sqlImport:start ガード（consume 前）→ Task 7 ✅
- spec §6.4 menu exportSqlDump ガード → Task 8 ✅
- spec §7 CANCELLED の静かな処理（isCancelled + 各箇所）→ Task 9・10 ✅
- spec §9 テスト方針 → Task 1〜3・9 のユニットテスト ✅
- spec §10 受け入れ基準 → Task 11 手動チェック ✅

**精緻化:** spec §7 が挙げた runActiveTab/SQL 実行系のうち、readonly 専用の `runTable`・`explainActiveTab` は CANCELLED にならないため対象外とし、実際に必要な `runSql`/`commitEdits`/`truncateTable`/`dropTable`/`SqlImportModal` の5箇所に限定した。

**型の一貫性:** `GuardTier`('readonly'|'write'|'catastrophic') と `ConfirmTier`('write'|'catastrophic') を区別。`confirmProductionAction` は `connName` を引数で受け、`productionGuard` が `getProductionContext().name` から供給する。CANCELLED の戻りは全箇所で `{ ok:false, error:{ code:'CANCELLED', message:'' } }` に統一。
