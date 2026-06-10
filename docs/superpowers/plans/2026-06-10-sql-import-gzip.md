# gzip 圧縮 SQL ダンプ（.sql.gz）import 対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQL ダンプ import を、gzip 圧縮された `.sql.gz` ファイルでも先頭2バイトのマジックバイト判定で自動展開して取り込めるようにする。

**Architecture:** 新規ヘルパー `gzip.ts` でファイル先頭2バイトを読んで gzip 判定する。`SqlImporter.ts` の読み取りを「生 Buffer ストリーム → 圧縮バイトカウンタ(Transform) →（gzip なら）`createGunzip()` → `StringDecoder('utf8')` → 既存 splitter」のパイプラインに置き換える。進捗は圧縮バイト基準（gunzip 前で計測）なので `totalBytes`（= `stat().size`）と整合し 0→100% で進む。`menu.ts` のダイアログフィルタを `['sql', 'gz']` に拡張する。非圧縮 `.sql` は同一経路を通り挙動は等価。

**Tech Stack:** TypeScript, Node.js streams (`fs`, `zlib.createGunzip`, `stream.Transform`, `string_decoder.StringDecoder`), Vitest, Electron `dialog`。

設計ドキュメント: `docs/superpowers/specs/2026-06-10-sql-import-gzip-design.md`

---

## File Structure

- **Create** `src/main/import/gzip.ts` — gzip 判定ヘルパー。純関数 `isGzipMagic(buf)` と薄い fs ラッパー `isGzipFile(filePath)` の2関数のみ。責務は「gzip かどうかの判定」に限定。
- **Create** `src/main/import/gzip.test.ts` — `isGzipMagic` のユニットテスト。
- **Modify** `src/main/import/SqlImporter.ts` — 読み取りパイプラインを gzip 対応に置き換え（`importSqlDump` 内部のみ。エクスポートシグネチャ・戻り値は不変）。
- **Modify** `src/main/import/SqlImporter.test.ts` — gzip ラウンドトリップのテストを追加。
- **Modify** `src/main/menu.ts` — ファイルダイアログの `extensions` を `['sql', 'gz']` に拡張。

---

## Task 1: gzip 判定ヘルパー

**Files:**
- Create: `src/main/import/gzip.ts`
- Test: `src/main/import/gzip.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/main/import/gzip.test.ts` を新規作成:

```ts
import { describe, it, expect } from 'vitest'
import { isGzipMagic } from './gzip'

describe('isGzipMagic', () => {
  it('gzip マジックバイト 0x1f 0x8b で始まる Buffer は true', () => {
    expect(isGzipMagic(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toBe(true)
  })

  it('テキスト（SQL）は false', () => {
    expect(isGzipMagic(Buffer.from('SELECT 1'))).toBe(false)
  })

  it('1バイトだけ（0x1f）は false', () => {
    expect(isGzipMagic(Buffer.from([0x1f]))).toBe(false)
  })

  it('空 Buffer は false', () => {
    expect(isGzipMagic(Buffer.alloc(0))).toBe(false)
  })

  it('2バイト目が 0x8b でなければ false', () => {
    expect(isGzipMagic(Buffer.from([0x1f, 0x00]))).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/import/gzip.test.ts`
Expected: FAIL（`./gzip` が存在せず import エラー）

- [ ] **Step 3: 最小実装を書く**

`src/main/import/gzip.ts` を新規作成:

```ts
import { open } from 'fs/promises'

/** Buffer 先頭が gzip マジックバイト（0x1f 0x8b）か。2バイト未満は false。 */
export function isGzipMagic(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

/** ファイル先頭2バイトだけ読んで gzip かを判定する。 */
export async function isGzipFile(filePath: string): Promise<boolean> {
  const fh = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(2)
    const { bytesRead } = await fh.read(buf, 0, 2, 0)
    return isGzipMagic(buf.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/import/gzip.test.ts`
Expected: PASS（5 件すべて）

- [ ] **Step 5: コミット**

```bash
git add src/main/import/gzip.ts src/main/import/gzip.test.ts
git commit -m "feat: gzip マジックバイト判定ヘルパー gzip.ts を追加"
```

---

## Task 2: SqlImporter の読み取りパイプラインを gzip 対応にする

**Files:**
- Modify: `src/main/import/SqlImporter.ts`
- Test: `src/main/import/SqlImporter.test.ts`

このタスクでは、生 Buffer 読み取り → 圧縮バイトカウンタ → gunzip（gzip 時のみ）→ `StringDecoder` → splitter のパイプラインに置き換える。`importSqlDump` の引数・戻り値・`runOne`/`failure`/`ImportSummary` ロジックは不変。

- [ ] **Step 1: 失敗するテスト（gzip ラウンドトリップ）を書く**

`src/main/import/SqlImporter.test.ts` の先頭 import に `gzipSync` と `writeFileSync` 用のヘルパーを追加する。ファイル冒頭の import 行を次に置き換える:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeFileSync, rmSync, statSync } from 'fs'
import { gzipSync } from 'zlib'
import { join } from 'path'
import { tmpdir } from 'os'
import { importSqlDump, type ImportExecutor } from './SqlImporter'
```

既存の `writeTmp` ヘルパーの直後（`afterEach` の前）に、gzip 版ヘルパーを追加する:

```ts
// gzip 圧縮した .sql.gz の一時ファイルを書き出す。
function writeTmpGz(name: string, content: string): string {
  const p = join(tmpdir(), `tableplus-import-test-${name}-${process.pid}.sql.gz`)
  writeFileSync(p, gzipSync(Buffer.from(content, 'utf-8')))
  tmpFiles.push(p)
  return p
}
```

`describe('importSqlDump', ...)` ブロックの末尾（最後の `it` の後、閉じ `})` の前）に次のテストを追加する:

```ts
it('gzip 圧縮された .sql.gz を展開して逐次実行する', async () => {
  const sql = 'CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);\n'
  const file = writeTmpGz('gz', sql)
  const { exec, manager } = fakeExecutor()
  const summary = await importSqlDump(manager, file, vi.fn())
  expect(summary.status).toBe('completed')
  expect(summary.executedCount).toBe(3)
  expect(exec).toHaveBeenCalledTimes(3)
})

it('gzip import の totalBytes は圧縮ファイルサイズ', async () => {
  const sql = 'SELECT 1;\nSELECT 2;\n'
  const file = writeTmpGz('gzsize', sql)
  const compressedSize = statSync(file).size
  const { manager } = fakeExecutor()
  const onProgress = vi.fn()
  await importSqlDump(manager, file, onProgress)
  const last = onProgress.mock.calls.at(-1)![0]
  expect(last.totalBytes).toBe(compressedSize)
})

it('マルチバイト UTF-8 を含む gzip を壊さず展開する', async () => {
  const sql = "INSERT INTO t VALUES ('日本語テスト');\n"
  const file = writeTmpGz('gzmb', sql)
  const { exec, manager } = fakeExecutor()
  const summary = await importSqlDump(manager, file, vi.fn())
  expect(summary.status).toBe('completed')
  expect(summary.executedCount).toBe(1)
  expect(exec.mock.calls[0][0]).toContain('日本語テスト')
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/main/import/SqlImporter.test.ts`
Expected: FAIL — 既存実装は gzip を生テキストとして読むため、`exec` に渡る文字列がバイナリで splitter が文を切り出せず `executedCount` が 3 にならない（または日本語が壊れる）。

- [ ] **Step 3: SqlImporter.ts を gzip 対応パイプラインに書き換える**

`src/main/import/SqlImporter.ts` の冒頭 import を次に置き換える:

```ts
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createGunzip } from 'zlib'
import { Transform } from 'stream'
import { StringDecoder } from 'string_decoder'
import type { ImportSummary, ImportProgress } from '../../shared/types'
import { SqlStatementSplitter } from './sqlStatementSplitter'
import { isGzipFile } from './gzip'
```

`totalBytes` の取得直後（`const start = Date.now()` の前）に gzip 判定を追加する:

```ts
  const totalBytes = (await stat(filePath)).size
  const gzip = await isGzipFile(filePath)
  const start = Date.now()
```

`withDedicatedConnection` のコールバック本体を、現状の `splitter`/`stream` 宣言から `finally` ブロックまで、次の内容に置き換える（`runOne` の定義は変更しない）:

```ts
  await manager.withDedicatedConnection(async (exec) => {
    const splitter = new SqlStatementSplitter()
    const decoder = new StringDecoder('utf8')
    const raw = createReadStream(filePath)

    // gunzip の前段で「圧縮バイト」を数える。totalBytes（圧縮サイズ）と整合し進捗が 0→100% になる。
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb): void {
        bytesRead += chunk.length
        cb(null, chunk)
      }
    })
    const byteSource = raw.pipe(counter)
    const textSource = gzip ? byteSource.pipe(createGunzip()) : byteSource

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
      for await (const chunk of textSource) {
        const text = decoder.write(chunk as Buffer)
        if (text) {
          for (const stmt of splitter.push(text)) {
            if (!(await runOne(stmt))) return
          }
        }
      }
      const tail = decoder.end()
      if (tail) {
        for (const stmt of splitter.push(tail)) {
          if (!(await runOne(stmt))) return
        }
      }
      for (const stmt of splitter.end()) {
        if (!(await runOne(stmt))) return
      }
    } catch (err) {
      // ここに来る例外は読み取り/展開の失敗のみ（DB エラーは runOne 内で握る）。
      if (gzip) {
        throw new Error('gzip の展開に失敗しました（ファイルが壊れている可能性があります）')
      }
      throw err
    } finally {
      raw.destroy()
    }
  })
```

> 注: 元の実装で `runOne` は `try` ブロックより前に定義されていた。上の置き換えでも `runOne` を `try` の前に置いており定義位置は等価。`bytesRead`/`executedCount`/`failure` は `importSqlDump` スコープの既存変数を引き続き参照する。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/main/import/SqlImporter.test.ts`
Expected: PASS（既存 3 件 + 新規 3 件 = 6 件）。特に非圧縮の既存テスト（`status=completed`、`failed`、`onProgress`）が引き続き通ること。

- [ ] **Step 5: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: typecheck エラーなし、全テスト PASS。

- [ ] **Step 6: コミット**

```bash
git add src/main/import/SqlImporter.ts src/main/import/SqlImporter.test.ts
git commit -m "feat: SQL import パイプラインを gzip(.sql.gz)展開に対応"
```

---

## Task 3: ファイルダイアログのフィルタを .gz に拡張

**Files:**
- Modify: `src/main/menu.ts:98`

メニューの import ダイアログで `.sql.gz` を選べるようにする。ロジックテストは無いため目視 + typecheck で確認する。

- [ ] **Step 1: フィルタを変更**

`src/main/menu.ts` の 98 行目を次に置き換える:

```ts
    filters: [{ name: 'SQL dump', extensions: ['sql', 'gz'] }]
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add src/main/menu.ts
git commit -m "feat: SQL import ダイアログで .sql.gz を選択可能にする"
```

---

## 完了条件

- `npm run typecheck` と `npm test` が通る。
- gzip ラウンドトリップテスト（展開・逐次実行・圧縮 totalBytes・マルチバイト）が PASS。
- 非圧縮 `.sql` の既存テストが引き続き PASS（挙動不変）。
- import ダイアログで `.sql.gz` が選択でき、選択後に既存の確認モーダル → 逐次実行フローが動く。
