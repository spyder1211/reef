# SQL dump import / restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File メニューから `.sql` ダンプを選び、接続中の MySQL DB へ statement 逐次・stop-on-error で restore し、進捗・実行ログ・成否を renderer モーダルに表示する。

**Architecture:** main 側で `.sql` を fs ストリーム読みし、自前のインクリメンタル splitter で statement に分割、pool から借りた専用接続1本で逐次実行する（`SET FOREIGN_KEY_CHECKS=0` 等のセッション設定を全文で効かせるため）。File メニューがファイルを選んで main 側 state に保持し、renderer のモーダルが確認→実行→進捗→summary を駆動する。renderer にはファイル本体を渡さない（パス非受領 + 進捗イベントのみ）。

**Tech Stack:** Electron (main/preload/renderer)、TypeScript、mysql2、React 18、vitest。テストは vitest（`describe/it/expect`、日本語テスト名）。

参照 spec: `docs/superpowers/specs/2026-06-09-sql-dump-import-design.md`

---

## ファイル構成

**新規作成（main）**
- `src/main/import/sqlStatementSplitter.ts` — インクリメンタル statement splitter（純粋・副作用なし）
- `src/main/import/sqlStatementSplitter.test.ts` — splitter のユニットテスト（厚め）
- `src/main/import/SqlImporter.ts` — restore オーケストレーター `importSqlDump()`
- `src/main/import/SqlImporter.test.ts` — フェイク executor + 一時ファイルでのテスト
- `src/main/import/importState.ts` — menu↔IPC 間で共有する保留パス / 実行中フラグ
- `src/main/import/importState.test.ts` — consume/busy セマンティクスのテスト
- `src/main/import/registerImportHandlers.ts` — `sqlImport:start` IPC ハンドラ

**新規作成（renderer）**
- `src/renderer/src/workspace/SqlImportModal.tsx` — 確認/進捗/結果モーダル
- `src/renderer/src/workspace/SqlImportModal.module.css` — モーダルのスタイル

**修正**
- `src/shared/types.ts` — `ImportSummary` / `ImportProgress` / `SqlImportRequest` を追加
- `src/main/connection/ConnectionManager.ts` — `withDedicatedConnection()` を追加
- `src/main/connection/ConnectionManager.dedicated.test.ts`（新規）— フェイク pool でのユニットテスト
- `src/main/menu.ts` — File に「SQLダンプをインポート / リストア…」を追加
- `src/main/index.ts` — `registerImportHandlers(manager)` を登録
- `src/preload/index.ts` — `window.api.sqlImport` を追加
- `src/renderer/src/env.d.ts` — `window.api.sqlImport` の型を追加
- `src/renderer/src/App.tsx` — `<SqlImportModal />` をマウント

---

## Task 1: 共有型を追加（ImportSummary / ImportProgress / SqlImportRequest）

**Files:**
- Modify: `src/shared/types.ts`（末尾に追記）

- [ ] **Step 1: 型を追加**

`src/shared/types.ts` の末尾（`SaveFileResult` の後）に追記する:

```ts
// SQL dump import / restore の実行結果サマリ
export interface ImportSummary {
  status: 'completed' | 'failed'
  executedCount: number // 成功実行できた statement 数
  durationMs: number
  failure?: {
    statementIndex: number // 1始まり：失敗した statement の番号
    statementPreview: string // 該当 statement の先頭 N 文字
    message: string // DB エラーメッセージ
  }
}

// import 実行中に main → renderer へ push する進捗
export interface ImportProgress {
  executedCount: number
  bytesRead: number
  totalBytes: number
  currentPreview?: string // 実行中/直近 statement の先頭
}

// File メニューでファイル選択後、main → renderer へ送る開始要求
export interface SqlImportRequest {
  fileName: string
  totalBytes: number
  dbName: string
}
```

- [ ] **Step 2: 型チェックが通ることを確認**

Run: `npm run typecheck`
Expected: エラーなしで完了（追加した型はまだ未使用だが構文として通る）

- [ ] **Step 3: コミット**

```bash
git add src/shared/types.ts
git commit -m "feat: SQL import 用の共有型 ImportSummary/ImportProgress/SqlImportRequest を追加 (#11)"
```

---

## Task 2: SQL statement splitter（TDD・本機能の品質の核）

**Files:**
- Create: `src/main/import/sqlStatementSplitter.ts`
- Test: `src/main/import/sqlStatementSplitter.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/import/sqlStatementSplitter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SqlStatementSplitter } from './sqlStatementSplitter'

// 1 回 push して end() した結果をまとめて取得するヘルパー
function splitAll(input: string): string[] {
  const s = new SqlStatementSplitter()
  return [...s.push(input), ...s.end()]
}

describe('SqlStatementSplitter', () => {
  it('単純な複数文を ; で分割し、末尾 ; を除いて返す', () => {
    expect(splitAll('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('末尾にセミコロンが無い最終文も返す', () => {
    expect(splitAll('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('空文（;;）や空白のみは捨てる', () => {
    expect(splitAll('SELECT 1;;  ;\n')).toEqual(['SELECT 1'])
  })

  it('シングルクォート文字列内の ; は区切らない', () => {
    expect(splitAll("INSERT INTO t VALUES ('a;b');")).toEqual(["INSERT INTO t VALUES ('a;b')"])
  })

  it("シングルクォートの \\' エスケープを跨ぐ", () => {
    expect(splitAll("INSERT INTO t VALUES ('a\\'; b');")).toEqual([
      "INSERT INTO t VALUES ('a\\'; b')"
    ])
  })

  it("'' 連続クォートはリテラル内として扱う", () => {
    expect(splitAll("INSERT INTO t VALUES ('it''s; ok');")).toEqual([
      "INSERT INTO t VALUES ('it''s; ok')"
    ])
  })

  it('ダブルクォート文字列内の ; は区切らない', () => {
    expect(splitAll('INSERT INTO t VALUES ("x;y");')).toEqual(['INSERT INTO t VALUES ("x;y")'])
  })

  it('バッククォート識別子内の ; は区切らない', () => {
    expect(splitAll('SELECT `a;b` FROM t;')).toEqual(['SELECT `a;b` FROM t'])
  })

  it('行コメント -- は除去し、後続の文は分割する', () => {
    expect(splitAll('-- hello; world\nSELECT 1;')).toEqual(['SELECT 1'])
  })

  it('# 行コメントも除去する', () => {
    expect(splitAll('# comment;\nSELECT 1;')).toEqual(['SELECT 1'])
  })

  it('-- の直後が空白でない場合はコメントにしない', () => {
    // 4-2 のような式の -- は演算子。コメント化しないこと（中身は実行側に委ねる）
    expect(splitAll('SELECT 4--2;')).toEqual(['SELECT 4--2'])
  })

  it('ブロックコメント /* */ を除去する', () => {
    expect(splitAll('/* c; c */ SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('CRLF を跨いで分割できる', () => {
    expect(splitAll('SELECT 1;\r\nSELECT 2;\r\n')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('先頭 BOM を除去する', () => {
    expect(splitAll('﻿SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('チャンク境界が文字列途中に来ても正しく連結する', () => {
    const s = new SqlStatementSplitter()
    const out = [...s.push("INSERT INTO t VALUES ('a;"), ...s.push("b');"), ...s.end()]
    expect(out).toEqual(["INSERT INTO t VALUES ('a;b')"])
  })

  it('チャンク境界が ; の直後に来ても重複や欠落がない', () => {
    const s = new SqlStatementSplitter()
    const out = [...s.push('SELECT 1;'), ...s.push('SELECT 2;'), ...s.end()]
    expect(out).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('複数行 INSERT をまとめて1文として返す', () => {
    const sql = 'INSERT INTO `t` (`a`,`b`)\nVALUES (1,2),\n(3,4);\n'
    expect(splitAll(sql)).toEqual(['INSERT INTO `t` (`a`,`b`)\nVALUES (1,2),\n(3,4)'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/import/sqlStatementSplitter.test.ts`
Expected: FAIL（`Cannot find module './sqlStatementSplitter'`）

- [ ] **Step 3: 実装を書く**

`src/main/import/sqlStatementSplitter.ts`:

```ts
// SQL ダンプを statement 単位に分割するインクリメンタル splitter。
// 文字列リテラル（'...' "..."）・識別子（`...`）・コメント（-- / # / 行末、/* */）内の
// ; は区切りとして扱わない。コメントは出力から除去する。
// 各 statement は trim 済み・末尾 ; なし。空や空白/コメントのみは返さない。

type Mode = 'normal' | 'single' | 'double' | 'backtick' | 'line' | 'block'

export class SqlStatementSplitter {
  private buf = ''
  private mode: Mode = 'normal'
  private bomStripped = false

  // チャンクを与え、完成した statement の配列を返す（残りは内部バッファに保持）。
  push(chunk: string): string[] {
    let s = chunk
    if (!this.bomStripped) {
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
      this.bomStripped = true
    }
    const out: string[] = []
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      const next = i + 1 < s.length ? s[i + 1] : ''
      switch (this.mode) {
        case 'normal':
          if (c === "'") {
            this.mode = 'single'
            this.buf += c
          } else if (c === '"') {
            this.mode = 'double'
            this.buf += c
          } else if (c === '`') {
            this.mode = 'backtick'
            this.buf += c
          } else if (c === '#') {
            this.mode = 'line'
          } else if (
            c === '-' &&
            next === '-' &&
            (i + 2 >= s.length || /\s/.test(s[i + 2] ?? ' '))
          ) {
            // "--" の後ろが空白/EOL/EOF のときだけ行コメント（MySQL 準拠）
            this.mode = 'line'
            i++ // 2 文字目の "-" を消費
          } else if (c === '/' && next === '*') {
            this.mode = 'block'
            i++ // "*" を消費
          } else if (c === ';') {
            this.emit(out)
          } else {
            this.buf += c
          }
          break
        case 'single':
        case 'double': {
          const q = this.mode === 'single' ? "'" : '"'
          this.buf += c
          if (c === '\\') {
            // 次の 1 文字をエスケープとして取り込む
            if (next) {
              this.buf += next
              i++
            }
          } else if (c === q) {
            if (next === q) {
              // '' や "" の連続はリテラル内
              this.buf += next
              i++
            } else {
              this.mode = 'normal'
            }
          }
          break
        }
        case 'backtick':
          // バッククォート識別子は \\ エスケープ無し。`` の連続でエスケープ。
          this.buf += c
          if (c === '`') {
            if (next === '`') {
              this.buf += next
              i++
            } else {
              this.mode = 'normal'
            }
          }
          break
        case 'line':
          // 改行までコメント。改行は残してトークンが繋がらないようにする。
          if (c === '\n') {
            this.mode = 'normal'
            this.buf += c
          }
          break
        case 'block':
          if (c === '*' && next === '/') {
            this.mode = 'normal'
            i++ // "/" を消費
          }
          break
      }
    }
    return out
  }

  // 末尾の残りバッファを flush する（末尾 ; が無い最終文用）。
  end(): string[] {
    const out: string[] = []
    this.emit(out)
    return out
  }

  private emit(out: string[]): void {
    const stmt = this.buf.trim()
    this.buf = ''
    if (stmt.length > 0) out.push(stmt)
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/import/sqlStatementSplitter.test.ts`
Expected: PASS（全ケース green）

- [ ] **Step 5: コミット**

```bash
git add src/main/import/sqlStatementSplitter.ts src/main/import/sqlStatementSplitter.test.ts
git commit -m "feat: SQL ダンプ用のインクリメンタル statement splitter を追加 (#11)"
```

---

## Task 3: ConnectionManager.withDedicatedConnection（TDD・フェイク pool）

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`
- Test: `src/main/connection/ConnectionManager.dedicated.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/connection/ConnectionManager.dedicated.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ConnectionManager } from './ConnectionManager'

// private な pool にフェイクを差し込んで withDedicatedConnection を検証する。
function withFakePool(): {
  mgr: ConnectionManager
  conn: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
} {
  const conn = {
    query: vi.fn().mockResolvedValue([{}, []]),
    release: vi.fn(),
    destroy: vi.fn()
  }
  const fakePool = { getConnection: vi.fn().mockResolvedValue(conn) }
  const mgr = new ConnectionManager()
  ;(mgr as unknown as { pool: unknown }).pool = fakePool
  return { mgr, conn }
}

describe('ConnectionManager.withDedicatedConnection', () => {
  it('未接続なら throw する', async () => {
    const mgr = new ConnectionManager()
    await expect(mgr.withDedicatedConnection(async () => 0)).rejects.toThrow('Not connected')
  })

  it('exec が同一接続で query を呼び、正常終了で release する', async () => {
    const { mgr, conn } = withFakePool()
    const result = await mgr.withDedicatedConnection(async (exec) => {
      await exec('SELECT 1')
      await exec('SELECT 2')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(conn.query).toHaveBeenCalledTimes(2)
    expect(conn.query).toHaveBeenNthCalledWith(1, 'SELECT 1')
    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(conn.destroy).not.toHaveBeenCalled()
  })

  it('fn が throw したら接続を destroy して再 throw する', async () => {
    const { mgr, conn } = withFakePool()
    await expect(
      mgr.withDedicatedConnection(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(conn.destroy).toHaveBeenCalledTimes(1)
    expect(conn.release).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/connection/ConnectionManager.dedicated.test.ts`
Expected: FAIL（`withDedicatedConnection is not a function`）

- [ ] **Step 3: 実装を書く**

`src/main/connection/ConnectionManager.ts` の `streamRows` メソッドの直後（`isConnected()` の前）に追加:

```ts
  // pool から1本借り、その接続だけで動く exec(sql) を fn に渡す。
  // import 用：SET FOREIGN_KEY_CHECKS=0 等の接続単位セッション設定を全 statement に効かせるため、
  // 全文を必ず同一接続で流す。正常終了で release、異常終了で destroy（streamRows と同じ契約）。
  async withDedicatedConnection<T>(
    fn: (exec: (sql: string) => Promise<void>) => Promise<T>
  ): Promise<T> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    const exec = async (sql: string): Promise<void> => {
      await conn.query(sql)
    }
    try {
      const result = await fn(exec)
      conn.release()
      return result
    } catch (err) {
      conn.destroy()
      throw err
    }
  }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/connection/ConnectionManager.dedicated.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/connection/ConnectionManager.ts src/main/connection/ConnectionManager.dedicated.test.ts
git commit -m "feat: ConnectionManager に withDedicatedConnection を追加 (#11)"
```

---

## Task 4: SqlImporter.importSqlDump（TDD・フェイク executor + 一時ファイル）

**Files:**
- Create: `src/main/import/SqlImporter.ts`
- Test: `src/main/import/SqlImporter.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/import/SqlImporter.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { importSqlDump, type ImportExecutor } from './SqlImporter'

const tmpFiles: string[] = []
function writeTmp(name: string, content: string): string {
  const p = join(tmpdir(), `tableplus-import-test-${name}-${process.pid}.sql`)
  writeFileSync(p, content, 'utf-8')
  tmpFiles.push(p)
  return p
}
afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    try {
      rmSync(p)
    } catch {
      // ignore
    }
  }
})

// exec の挙動を制御するフェイク executor。failOn に一致した sql で throw する。
function fakeExecutor(opts?: { failOn?: string; error?: Error }): {
  exec: ReturnType<typeof vi.fn>
  manager: ImportExecutor
} {
  const exec = vi.fn(async (sql: string) => {
    if (opts?.failOn && sql.includes(opts.failOn)) {
      throw opts.error ?? new Error('exec failed')
    }
  })
  const manager: ImportExecutor = {
    withDedicatedConnection: async (fn) => fn(exec)
  }
  return { exec, manager }
}

describe('importSqlDump', () => {
  it('全文成功で status=completed と executedCount を返す', async () => {
    const file = writeTmp('ok', 'CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\n')
    const { exec, manager } = fakeExecutor()
    const onProgress = vi.fn()
    const summary = await importSqlDump(manager, file, onProgress)
    expect(summary.status).toBe('completed')
    expect(summary.executedCount).toBe(2)
    expect(summary.failure).toBeUndefined()
    expect(exec).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalled()
  })

  it('途中の statement でエラーなら status=failed・以降を実行しない', async () => {
    const file = writeTmp(
      'fail',
      'CREATE TABLE t (id INT);\nINSERT INTO bad VALUES (1);\nINSERT INTO t VALUES (2);\n'
    )
    const { exec, manager } = fakeExecutor({ failOn: 'INSERT INTO bad', error: new Error('no such table') })
    const summary = await importSqlDump(manager, file, vi.fn())
    expect(summary.status).toBe('failed')
    expect(summary.executedCount).toBe(1) // CREATE TABLE のみ成功
    expect(summary.failure?.statementIndex).toBe(2)
    expect(summary.failure?.message).toBe('no such table')
    expect(summary.failure?.statementPreview).toContain('INSERT INTO bad')
    // 3 文目は実行されない（CREATE と bad の 2 回のみ）
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('onProgress に executedCount/bytesRead/totalBytes が渡る', async () => {
    const file = writeTmp('prog', 'SELECT 1;\nSELECT 2;\n')
    const { manager } = fakeExecutor()
    const onProgress = vi.fn()
    const summary = await importSqlDump(manager, file, onProgress)
    expect(summary.executedCount).toBe(2)
    const last = onProgress.mock.calls.at(-1)![0]
    expect(last.executedCount).toBe(2)
    expect(last.totalBytes).toBeGreaterThan(0)
    expect(last.bytesRead).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/import/SqlImporter.test.ts`
Expected: FAIL（`Cannot find module './SqlImporter'`）

- [ ] **Step 3: 実装を書く**

`src/main/import/SqlImporter.ts`:

```ts
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import type { ImportSummary, ImportProgress } from '../../shared/types'
import { SqlStatementSplitter } from './sqlStatementSplitter'

// statement プレビューの最大文字数
const PREVIEW_LEN = 200

// ConnectionManager のうち import が必要とする最小インターフェース（テスト容易化のため）。
export interface ImportExecutor {
  withDedicatedConnection<T>(fn: (exec: (sql: string) => Promise<void>) => Promise<T>): Promise<T>
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// .sql ファイルをストリーム読み → splitter → 専用接続1本で逐次実行。stop-on-error。
export async function importSqlDump(
  manager: ImportExecutor,
  filePath: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportSummary> {
  const totalBytes = (await stat(filePath)).size
  const start = Date.now()
  let executedCount = 0
  let bytesRead = 0
  let failure: ImportSummary['failure'] | undefined

  await manager.withDedicatedConnection(async (exec) => {
    const splitter = new SqlStatementSplitter()
    const stream = createReadStream(filePath, { encoding: 'utf-8' })

    // 1 文を実行し、成功なら true。失敗なら failure を記録して false（呼び出し側が停止する）。
    const runOne = async (stmt: string): Promise<boolean> => {
      try {
        await exec(stmt)
        executedCount++
        onProgress({
          executedCount,
          bytesRead,
          totalBytes,
          currentPreview: stmt.slice(0, PREVIEW_LEN)
        })
        return true
      } catch (err) {
        failure = {
          statementIndex: executedCount + 1,
          statementPreview: stmt.slice(0, PREVIEW_LEN),
          message: messageOf(err)
        }
        return false
      }
    }

    try {
      for await (const chunk of stream) {
        const text = chunk as string
        bytesRead += Buffer.byteLength(text, 'utf-8')
        for (const stmt of splitter.push(text)) {
          if (!(await runOne(stmt))) return
        }
      }
      for (const stmt of splitter.end()) {
        if (!(await runOne(stmt))) return
      }
    } finally {
      stream.destroy()
    }
  })

  return {
    status: failure ? 'failed' : 'completed',
    executedCount,
    durationMs: Date.now() - start,
    ...(failure ? { failure } : {})
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/import/SqlImporter.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/main/import/SqlImporter.ts src/main/import/SqlImporter.test.ts
git commit -m "feat: SQL dump restore オーケストレーター importSqlDump を追加 (#11)"
```

---

## Task 5: importState（保留パス / 実行中フラグ）と IPC ハンドラ

**Files:**
- Create: `src/main/import/importState.ts`
- Test: `src/main/import/importState.test.ts`
- Create: `src/main/import/registerImportHandlers.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: importState の失敗するテストを書く**

`src/main/import/importState.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPendingImport,
  consumePendingImport,
  isImporting,
  setImporting
} from './importState'

describe('importState', () => {
  beforeEach(() => {
    // 各テスト前に状態をクリア
    consumePendingImport()
    setImporting(false)
  })

  it('保留パスは consume で1回だけ取得でき、2回目は null', () => {
    setPendingImport('/tmp/a.sql')
    expect(consumePendingImport()).toBe('/tmp/a.sql')
    expect(consumePendingImport()).toBeNull()
  })

  it('実行中フラグを get/set できる', () => {
    expect(isImporting()).toBe(false)
    setImporting(true)
    expect(isImporting()).toBe(true)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/import/importState.test.ts`
Expected: FAIL（`Cannot find module './importState'`）

- [ ] **Step 3: importState を実装**

`src/main/import/importState.ts`:

```ts
// File メニュー（ファイル選択）と IPC ハンドラ（実行）の間で共有する状態。
// renderer から任意パスを注入させないため、main 側が選んだパスのみを保持・消費する。

let pendingImportPath: string | null = null
let importing = false

export function setPendingImport(path: string): void {
  pendingImportPath = path
}

// 保留中のパスを返し、内部状態はクリアする（1 回のみ消費可能）。
export function consumePendingImport(): string | null {
  const p = pendingImportPath
  pendingImportPath = null
  return p
}

export function isImporting(): boolean {
  return importing
}

export function setImporting(v: boolean): void {
  importing = v
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/import/importState.test.ts`
Expected: PASS

- [ ] **Step 5: IPC ハンドラを実装**

`src/main/import/registerImportHandlers.ts`:

```ts
import { ipcMain } from 'electron'
import type { ConnectionManager } from '../connection/ConnectionManager'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ApiResult, ImportSummary } from '../../shared/types'
import { importSqlDump } from './SqlImporter'
import { consumePendingImport, isImporting, setImporting } from './importState'

// 進捗 push の throttle 間隔（ミリ秒）。大きな dump で IPC を溢れさせない。
const PROGRESS_THROTTLE_MS = 100

export function registerImportHandlers(manager: ConnectionManager): void {
  ipcMain.handle('sqlImport:start', async (e): Promise<ApiResult<ImportSummary>> => {
    const filePath = consumePendingImport()
    if (!filePath) {
      return {
        ok: false,
        error: { code: 'NO_PENDING_IMPORT', message: 'インポート対象のファイルが選択されていません' }
      }
    }
    if (isImporting()) {
      return { ok: false, error: { code: 'IMPORT_BUSY', message: '別のインポートが実行中です' } }
    }
    setImporting(true)
    let last = 0
    try {
      const summary = await importSqlDump(manager, filePath, (p) => {
        const now = Date.now()
        if (now - last >= PROGRESS_THROTTLE_MS) {
          last = now
          e.sender.send('app:sql-import-progress', p)
        }
      })
      return { ok: true, data: summary }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    } finally {
      setImporting(false)
    }
  })
}
```

- [ ] **Step 6: index.ts に登録**

`src/main/index.ts` を編集する。

import 行を追加（既存の import 群の最後、`import { buildAppMenu } ...` の後など）:

```ts
import { registerImportHandlers } from './import/registerImportHandlers'
```

`app.whenReady().then(() => { ... })` 内、`registerFileHandlers()` の直後に追加:

```ts
  registerImportHandlers(manager)
```

- [ ] **Step 7: 型チェックとテストが通ることを確認**

Run: `npm run typecheck && npx vitest run src/main/import/`
Expected: typecheck エラーなし、import 配下のテストが全て PASS

- [ ] **Step 8: コミット**

```bash
git add src/main/import/importState.ts src/main/import/importState.test.ts src/main/import/registerImportHandlers.ts src/main/index.ts
git commit -m "feat: SQL import の IPC ハンドラと保留パス管理を追加 (#11)"
```

---

## Task 6: File メニューに「SQLダンプをインポート / リストア…」を追加

**Files:**
- Modify: `src/main/menu.ts`

- [ ] **Step 1: import を追加**

`src/main/menu.ts` の先頭の import 群を編集する。

既存:
```ts
import { Menu, dialog, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { createWriteStream } from 'fs'
import { once } from 'events'
import type { ConnectionManager } from './connection/ConnectionManager'
import { dumpDatabase } from './dump/SqlDumper'
```

これを以下に置き換える（`stat` / `basename` / `setPendingImport` を追加）:
```ts
import { Menu, dialog, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { basename } from 'path'
import { once } from 'events'
import type { ConnectionManager } from './connection/ConnectionManager'
import { dumpDatabase } from './dump/SqlDumper'
import { setPendingImport } from './import/importState'
```

- [ ] **Step 2: import フローの関数を追加**

`src/main/menu.ts` の `exportSqlDump` 関数の直後（`buildAppMenu` の前）に追加:

```ts
// File →「SQLダンプをインポート / リストア…」の本体。
// 接続確認 → ファイル選択 → 選択パスを main 側に保持 → renderer に開始要求を送る。
// 実際の実行は renderer の確認モーダル経由で sqlImport:start が呼ばれて行われる。
async function importSqlDump(manager: ConnectionManager): Promise<void> {
  if (!manager.isConnected()) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'DB に接続していません',
      detail: '接続してから SQL ダンプを import してください。'
    })
    return
  }

  // 確認表示用に接続中の DB 名を取得（失敗時は空文字）。
  let dbName = ''
  try {
    const res = await manager.query('SELECT DATABASE() AS db')
    const db = res.rows[0]?.db
    if (db) dbName = String(db)
  } catch {
    // ignore: 空のまま続行
  }

  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    properties: ['openFile' as const],
    filters: [{ name: 'SQL', extensions: ['sql'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return

  const filePath = result.filePaths[0]
  const { size } = await stat(filePath)
  setPendingImport(filePath)
  win?.webContents.send('app:sql-import-request', {
    fileName: basename(filePath),
    totalBytes: size,
    dbName
  })
}
```

- [ ] **Step 3: メニュー項目を追加**

`src/main/menu.ts` の File submenu を編集する。

既存:
```ts
      submenu: [
        {
          label: 'SQLダンプをエクスポート…',
          click: () => {
            // 捕捉漏れ（ダイアログ拒否など）でメインプロセスが落ちないよう最終防衛で握る。
            exportSqlDump(manager).catch((err) => {
              console.error('exportSqlDump failed:', err)
            })
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
```

これを以下に置き換える:
```ts
      submenu: [
        {
          label: 'SQLダンプをエクスポート…',
          click: () => {
            // 捕捉漏れ（ダイアログ拒否など）でメインプロセスが落ちないよう最終防衛で握る。
            exportSqlDump(manager).catch((err) => {
              console.error('exportSqlDump failed:', err)
            })
          }
        },
        {
          label: 'SQLダンプをインポート / リストア…',
          click: () => {
            importSqlDump(manager).catch((err) => {
              console.error('importSqlDump failed:', err)
            })
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
```

- [ ] **Step 4: 型チェックが通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/main/menu.ts
git commit -m "feat: File メニューに SQLダンプの import / restore を追加 (#11)"
```

---

## Task 7: preload と renderer 型定義に sqlImport を追加

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: preload に sqlImport を追加**

`src/preload/index.ts` の import 群に型を追加する。

既存の型 import:
```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult
} from '../shared/types'
```
これを以下に置き換える:
```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult,
  ImportSummary,
  ImportProgress,
  SqlImportRequest
} from '../shared/types'
```

`api` オブジェクトの `connections: { ... }` の直前に `sqlImport` ブロックを追加:
```ts
  sqlImport: {
    // File メニューからの開始要求を購読。登録解除関数を返す。
    onRequest: (cb: (req: SqlImportRequest) => void): (() => void) => {
      const handler = (_e: unknown, req: SqlImportRequest): void => cb(req)
      ipcRenderer.on('app:sql-import-request', handler)
      return () => ipcRenderer.removeListener('app:sql-import-request', handler)
    },
    // 保留中のファイルを実行（パスは渡さない）。
    start: (): Promise<ApiResult<ImportSummary>> => ipcRenderer.invoke('sqlImport:start'),
    // 進捗を購読。登録解除関数を返す。
    onProgress: (cb: (p: ImportProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: ImportProgress): void => cb(p)
      ipcRenderer.on('app:sql-import-progress', handler)
      return () => ipcRenderer.removeListener('app:sql-import-progress', handler)
    }
  },
```

- [ ] **Step 2: env.d.ts に型を追加**

`src/renderer/src/env.d.ts` の型 import を編集する。

既存:
```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult
} from '../../shared/types'
```
これを以下に置き換える:
```ts
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult,
  ImportSummary,
  ImportProgress,
  SqlImportRequest
} from '../../shared/types'
```

`Window['api']` の `onReturnToConnections` 行の直後に追加:
```ts
      sqlImport: {
        onRequest: (cb: (req: SqlImportRequest) => void) => () => void
        start: () => Promise<ApiResult<ImportSummary>>
        onProgress: (cb: (p: ImportProgress) => void) => () => void
      }
```

- [ ] **Step 3: 型チェックが通ることを確認**

Run: `npm run typecheck`
Expected: エラーなし（preload と env.d.ts の `sqlImport` 形が一致）

- [ ] **Step 4: コミット**

```bash
git add src/preload/index.ts src/renderer/src/env.d.ts
git commit -m "feat: preload/renderer 型に sqlImport ブリッジを追加 (#11)"
```

---

## Task 8: renderer の SqlImportModal とマウント

**Files:**
- Create: `src/renderer/src/workspace/SqlImportModal.tsx`
- Create: `src/renderer/src/workspace/SqlImportModal.module.css`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: モーダルコンポーネントを作成**

`src/renderer/src/workspace/SqlImportModal.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ImportProgress, ImportSummary, SqlImportRequest } from '../../../shared/types'
import styles from './SqlImportModal.module.css'

type Phase = 'closed' | 'confirm' | 'running' | 'result'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function SqlImportModal(): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('closed')
  const [req, setReq] = useState<SqlImportRequest | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    const offReq = window.api.sqlImport.onRequest((r) => {
      setReq(r)
      setProgress(null)
      setSummary(null)
      setFatal(null)
      setPhase('confirm')
    })
    const offProg = window.api.sqlImport.onProgress((p) => setProgress(p))
    return () => {
      offReq()
      offProg()
    }
  }, [])

  if (phase === 'closed' || !req) return null

  const close = (): void => setPhase('closed')

  async function handleRun(): Promise<void> {
    setPhase('running')
    setProgress({ executedCount: 0, bytesRead: 0, totalBytes: req!.totalBytes })
    const res = await window.api.sqlImport.start()
    if (res.ok) setSummary(res.data)
    else setFatal(`${res.error.code}: ${res.error.message}`)
    setPhase('result')
  }

  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesRead / progress.totalBytes) * 100))
      : 0

  return (
    <div className={styles.backdrop} onClick={phase === 'running' ? undefined : close}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>SQL ダンプを import / restore</div>

        {phase === 'confirm' && (
          <>
            <div className={styles.row}>
              <span className={styles.k}>接続中の DB</span>
              <b>{req.dbName || '(未選択)'}</b>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>ファイル</span>
              <span>{req.fileName}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>サイズ</span>
              <span>{formatBytes(req.totalBytes)}</span>
            </div>
            <div className={styles.warn}>
              この dump は <b>DROP / CREATE / INSERT</b> を含む可能性があり、対象 DB の既存データを
              上書きします。MySQL の DDL は暗黙コミットされるため、途中で失敗してもそこまでの変更は
              ロールバックされません。
            </div>
            <div className={styles.actions}>
              <button className={styles.btn} onClick={close}>
                キャンセル
              </button>
              <button className={styles.btnDanger} onClick={() => void handleRun()}>
                実行する
              </button>
            </div>
          </>
        )}

        {phase === 'running' && progress && (
          <>
            <div className={styles.bar}>
              <div className={styles.barFill} style={{ width: `${pct}%` }} />
            </div>
            <div className={styles.row}>
              <span className={styles.k}>進捗</span>
              <span>
                {pct}%（{formatBytes(progress.bytesRead)} / {formatBytes(progress.totalBytes)}）
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>実行済み</span>
              <span>{progress.executedCount} 文</span>
            </div>
            {progress.currentPreview && <div className={styles.preview}>{progress.currentPreview}</div>}
          </>
        )}

        {phase === 'result' && (
          <>
            {fatal && <div className={styles.error}>{fatal}</div>}
            {summary && summary.status === 'completed' && (
              <div className={styles.ok}>
                完了：{summary.executedCount} 文を実行しました（{summary.durationMs} ms）
              </div>
            )}
            {summary && summary.status === 'failed' && summary.failure && (
              <div className={styles.error}>
                <div>
                  失敗：{summary.failure.statementIndex} 文目でエラー（ここまで {summary.executedCount}{' '}
                  文を適用済み）
                </div>
                <div className={styles.preview}>{summary.failure.statementPreview}</div>
                <div className={styles.msg}>{summary.failure.message}</div>
              </div>
            )}
            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={close}>
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: CSS を作成**

`src/renderer/src/workspace/SqlImportModal.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  width: 460px;
  max-width: calc(100vw - 48px);
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  font-size: 13px;
  color: #1d1d1f;
}

.title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}

.k {
  color: #6e6e73;
}

.warn {
  margin: 12px 0;
  padding: 10px 12px;
  background: #fff4e5;
  border: 1px solid #ffd8a8;
  border-radius: 6px;
  line-height: 1.5;
  color: #8a5a00;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn,
.btnPrimary,
.btnDanger {
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

.btn {
  background: #e8e8ed;
  color: #1d1d1f;
}

.btnPrimary {
  background: #0071e3;
  color: #fff;
}

.btnDanger {
  background: #d70015;
  color: #fff;
}

.bar {
  height: 8px;
  background: #e8e8ed;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.barFill {
  height: 100%;
  background: #0071e3;
  transition: width 0.15s ease;
}

.preview {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f5f5f7;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow: auto;
}

.ok {
  padding: 10px 12px;
  background: #e6f4ea;
  border: 1px solid #b7e1c2;
  border-radius: 6px;
  color: #137333;
}

.error {
  padding: 10px 12px;
  background: #fce8e6;
  border: 1px solid #f5c2c0;
  border-radius: 6px;
  color: #c5221f;
  line-height: 1.5;
}

.msg {
  margin-top: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
```

- [ ] **Step 3: App.tsx にマウント**

`src/renderer/src/App.tsx` を編集する。

import を追加（既存 import 群の最後）:
```ts
import SqlImportModal from './workspace/SqlImportModal'
```

return 文を以下に置き換える:
```tsx
  return (
    <>
      {status === 'connected' ? <WorkspaceShell /> : <HomeScreen />}
      <SqlImportModal />
    </>
  )
```

- [ ] **Step 4: 型チェックとビルドが通ることを確認**

Run: `npm run typecheck && npm run build`
Expected: typecheck・build ともエラーなし

- [ ] **Step 5: コミット**

```bash
git add src/renderer/src/workspace/SqlImportModal.tsx src/renderer/src/workspace/SqlImportModal.module.css src/renderer/src/App.tsx
git commit -m "feat: SQL dump import の確認/進捗/結果モーダルを追加 (#11)"
```

---

## Task 9: 最終検証

**Files:**（変更なし。検証のみ）

- [ ] **Step 1: 全テスト**

Run: `npm test`
Expected: 全 PASS（splitter / importer / importState / withDedicatedConnection を含む。DB 必須の integration は skip）

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: ビルド**

Run: `npm run build`
Expected: エラーなし

- [ ] **Step 4: 手動確認チェックリスト（実 MySQL）**

`npm run dev` で起動し、以下を確認する（実 DB 必要・任意だが推奨）:
- 未接続で File →「SQLダンプをインポート / リストア…」→「DB に接続していません」が出る
- 接続後に同メニュー → `.sql` を選択 → 確認モーダルに 接続中DB名 / ファイル名 / サイズ / 危険警告が出る
- 「実行する」→ 進捗バーと実行済み文数が動き、完了で「N 文を実行しました」
- export で作った dump を別 DB へ import し、テーブルとデータが復元される（round-trip）
- わざと壊した `.sql`（存在しないテーブルへの INSERT 等）で、失敗文番号・プレビュー・エラーメッセージが表示される

- [ ] **Step 5: フォローアップをメモに記録**

`/Users/spyder/.claude/projects/-Users-spyder-c-table-tableplus/memory/` に `sql-dump-import-followups.md` を作成し、後回し項目（後述の「実装メモ / 既知の制限」）と未実施の手動確認を記録、`MEMORY.md` に索引行を追加する。

---

## 実装メモ / 既知の制限（spec 準拠・意図的に後回し）

- **進捗の throttle**: `sqlImport:start` ハンドラで 100ms 間隔。最後の数文の進捗が描画前に落ちても、最終 summary がモーダルに出るため UX 上問題なし。
- **MySQL 実行可能コメント `/*! ... */`**: ブロックコメントとして除去される。自社 dump は出力しないため v1 では非対応（mysqldump 完全互換は非スコープ）。
- **`DELIMITER` 構文**（ストアドプロシージャ等）: 非対応。splitter は将来 DELIMITER を足しやすい構造にしてある。
- **bytesRead は UTF-8 バイト換算の近似**: BOM 分のずれは進捗バー上のみで実害なし。
- **PostgreSQL**: executor は `ImportExecutor` インターフェースで分離済み。将来 PG executor を差し替えやすい。
- **トランザクション非使用**: MySQL の DDL 暗黙コミットのため全体ロールバックは原理上不可能。stop-on-error + UI 警告で対応。

---

## Self-Review 結果

- **Spec coverage**: UI 方式（renderer モーダル, Task 8）/ 実行モデル stop-on-error（Task 4）/ 接続中DBのみ（Task 6 で接続中DB名表示・新規DB作成なし）/ 軽量 splitter（Task 2）/ 専用接続 FK 整合（Task 3）/ 構造化エラー ok:true+failed・致命的 ok:false（Task 4,5）/ renderer 全量非搭載（Task 4 ストリーム + Task 6 パス非受領）/ 進捗・ログ表示（Task 8）— すべて対応タスクあり。
- **Placeholder scan**: プレースホルダなし。全コードブロックは実コード。
- **Type consistency**: `ImportSummary` / `ImportProgress` / `SqlImportRequest`（Task 1）、`ImportExecutor.withDedicatedConnection`（Task 3,4）、`window.api.sqlImport.{onRequest,start,onProgress}`（Task 7,8）、IPC チャンネル名 `sqlImport:start` / `app:sql-import-request` / `app:sql-import-progress`（Task 5,6,7）が全タスクで一致。
