# DB の SQL ダンプ エクスポート Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ネイティブ「ファイル」メニューから、接続中 DB の全ベーステーブルを スキーマ＋データの SQL ダンプ（mysqldump 風）としてファイル保存できるようにする。

**Architecture:** 純粋ヘルパー `sqlDumpHelpers.ts` が値エスケープ・INSERT/DDL 文字列化を担い（テスト対象）、`ConnectionManager.streamRows` が行をストリームで供給、`SqlDumper.dumpDatabase` がテーブルを列挙して逐次 `write` へ流し、`menu.ts` の File メニューがネイティブ保存ダイアログ＋ファイルストリームに対して実行する。すべてメインプロセスで完結。

**Tech Stack:** Electron (main) / TypeScript / mysql2 / Node fs streams / Vitest

設計: `docs/superpowers/specs/2026-06-08-sql-dump-export-design.md`

---

## ファイル構成

| ファイル | 区分 | 責務 |
|---|---|---|
| `src/main/dump/sqlDumpHelpers.ts` | 新規 | 値エスケープ・識別子クォート・INSERT/DDL/ヘッダ/フッタの文字列化（純粋関数） |
| `src/main/dump/sqlDumpHelpers.test.ts` | 新規 | 上記の単体テスト |
| `src/main/connection/ConnectionManager.ts` | 変更 | 行ストリーム取得 `streamRows` を追加 |
| `src/main/dump/SqlDumper.ts` | 新規 | DB 列挙＋テーブルごとに DDL＋行バッチを `write` へ流すオーケストレータ |
| `src/main/menu.ts` | 新規 | ネイティブメニュー構築＋ File →「SQLダンプをエクスポート…」のハンドラ |
| `src/main/index.ts` | 変更 | `Menu.setApplicationMenu(buildAppMenu(manager))` を適用 |

---

## Task 1: 純粋ヘルパー `sqlDumpHelpers.ts`

**Files:**
- Create: `src/main/dump/sqlDumpHelpers.ts`
- Test: `src/main/dump/sqlDumpHelpers.test.ts`

TDD: 失敗するテストを先に書く → 失敗確認 → 実装 → 成功確認 → コミット。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/main/dump/sqlDumpHelpers.test.ts` with EXACTLY this content:

```ts
import { describe, it, expect } from 'vitest'
import {
  quoteIdent,
  escapeSqlValue,
  buildInsert,
  buildDropAndCreate,
  dumpHeader,
  dumpFooter
} from './sqlDumpHelpers'

describe('quoteIdent', () => {
  it('バッククォートで囲む', () => {
    expect(quoteIdent('a')).toBe('`a`')
  })
  it('内部のバッククォートを2重化する', () => {
    expect(quoteIdent('we`ird')).toBe('`we``ird`')
  })
})

describe('escapeSqlValue', () => {
  it('null / undefined は NULL', () => {
    expect(escapeSqlValue(null)).toBe('NULL')
    expect(escapeSqlValue(undefined)).toBe('NULL')
  })
  it('数値はそのまま、非有限は NULL', () => {
    expect(escapeSqlValue(42)).toBe('42')
    expect(escapeSqlValue(-3.14)).toBe('-3.14')
    expect(escapeSqlValue(Infinity)).toBe('NULL')
  })
  it('bigint は文字列化', () => {
    expect(escapeSqlValue(123n)).toBe('123')
  })
  it('真偽値は 1 / 0', () => {
    expect(escapeSqlValue(true)).toBe('1')
    expect(escapeSqlValue(false)).toBe('0')
  })
  it('Buffer は 0x 16進、空 Buffer は空文字リテラル', () => {
    expect(escapeSqlValue(Buffer.from([0, 255]))).toBe('0x00ff')
    expect(escapeSqlValue(Buffer.alloc(0))).toBe("''")
  })
  it('文字列はシングルクォート囲み', () => {
    expect(escapeSqlValue('hello')).toBe("'hello'")
  })
  it('日時文字列もシングルクォート囲み', () => {
    expect(escapeSqlValue('2025-09-26 16:17:05')).toBe("'2025-09-26 16:17:05'")
  })
  it('シングルクォートをエスケープ', () => {
    expect(escapeSqlValue("a'b")).toBe("'a\\'b'")
  })
  it('バックスラッシュをエスケープ', () => {
    expect(escapeSqlValue('a\\b')).toBe("'a\\\\b'")
  })
  it('改行・タブ・CR・NUL・Ctrl-Z をエスケープ', () => {
    expect(escapeSqlValue('a\nb')).toBe("'a\\nb'")
    expect(escapeSqlValue('a\tb')).toBe("'a\\tb'")
    expect(escapeSqlValue('a\rb')).toBe("'a\\rb'")
    expect(escapeSqlValue('a\0b')).toBe("'a\\0b'")
    expect(escapeSqlValue('a\x1ab')).toBe("'a\\Zb'")
  })
})

describe('buildInsert', () => {
  it('空 rows は空文字', () => {
    expect(buildInsert('t', ['a'], [])).toBe('')
  })
  it('単一行', () => {
    expect(buildInsert('t', ['a', 'b'], [{ a: 1, b: 'x' }])).toBe(
      "INSERT INTO `t` (`a`, `b`) VALUES (1, 'x');\n"
    )
  })
  it('複数行（カンマ結合・NULL 含む）', () => {
    expect(
      buildInsert('t', ['a', 'b'], [
        { a: 1, b: 'x' },
        { a: 2, b: null }
      ])
    ).toBe("INSERT INTO `t` (`a`, `b`) VALUES (1, 'x'),(2, NULL);\n")
  })
})

describe('buildDropAndCreate', () => {
  it('DROP と CREATE をセミコロン付きで返す', () => {
    expect(buildDropAndCreate('t', 'CREATE TABLE `t` (`a` int)')).toBe(
      'DROP TABLE IF EXISTS `t`;\nCREATE TABLE `t` (`a` int);\n'
    )
  })
})

describe('dumpHeader / dumpFooter', () => {
  it('ヘッダに DB 名・生成日時・SET 文を含む', () => {
    const h = dumpHeader('mydb', '2026-06-08T00:00:00.000Z')
    expect(h).toContain('-- Database: mydb')
    expect(h).toContain('-- Generated: 2026-06-08T00:00:00.000Z')
    expect(h).toContain('SET NAMES utf8mb4;')
    expect(h).toContain('SET FOREIGN_KEY_CHECKS=0;')
  })
  it('フッタは FK チェックを戻す', () => {
    expect(dumpFooter()).toBe('\nSET FOREIGN_KEY_CHECKS=1;\n')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run src/main/dump/sqlDumpHelpers.test.ts`
Expected: FAIL（モジュール未作成でインポート解決不可）

- [ ] **Step 3: 実装を書く**

Create `src/main/dump/sqlDumpHelpers.ts` with EXACTLY this content:

```ts
// SQL ダンプの直列化ヘルパー（純粋関数・副作用なし）。
// 値は JS ランタイム型で判定する（ConnectionManager は dateStrings:true のため日時は文字列で届く）。

// 識別子をバッククォートで囲み、内部のバッククォートを2重化する。
export function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

// MySQL 文字列リテラルのエスケープ（シングルクォート囲み）。各マッチを独立に置換するため2重化は起きない。
function escapeString(s: string): string {
  const escaped = s.replace(/[\0\b\t\n\r\x1a\\']/g, (ch) => {
    switch (ch) {
      case '\0':
        return '\\0'
      case '\b':
        return '\\b'
      case '\t':
        return '\\t'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\x1a':
        return '\\Z'
      case '\\':
        return '\\\\'
      case "'":
        return "\\'"
      default:
        return ch
    }
  })
  return "'" + escaped + "'"
}

// 1 つの値を SQL リテラルに変換する。
export function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Buffer.isBuffer(value)) return value.length === 0 ? "''" : '0x' + value.toString('hex')
  return escapeString(String(value))
}

// 複数行をまとめた INSERT 文（末尾改行付き）。rows が空なら空文字。列順は columns に従う。
export function buildInsert(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return ''
  const cols = columns.map(quoteIdent).join(', ')
  const tuples = rows
    .map((row) => '(' + columns.map((c) => escapeSqlValue(row[c])).join(', ') + ')')
    .join(',')
  return `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES ${tuples};\n`
}

// DROP TABLE IF EXISTS と CREATE TABLE（SHOW CREATE TABLE の結果）をセミコロン付きで返す。
export function buildDropAndCreate(table: string, createTableSql: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(table)};\n${createTableSql};\n`
}

// ダンプ先頭のコメント＋セッション設定。
export function dumpHeader(dbName: string, generatedAt: string): string {
  return (
    `-- TablePlus SQL Dump\n` +
    `-- Database: ${dbName}\n` +
    `-- Generated: ${generatedAt}\n\n` +
    `SET NAMES utf8mb4;\n` +
    `SET FOREIGN_KEY_CHECKS=0;\n\n`
  )
}

// ダンプ末尾。FK チェックを元に戻す。
export function dumpFooter(): string {
  return `\nSET FOREIGN_KEY_CHECKS=1;\n`
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run src/main/dump/sqlDumpHelpers.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add src/main/dump/sqlDumpHelpers.ts src/main/dump/sqlDumpHelpers.test.ts
git commit -m "feat: SQL ダンプの直列化ヘルパー sqlDumpHelpers を追加"
```

---

## Task 2: `ConnectionManager.streamRows`（行ストリーム取得）

**Files:**
- Modify: `src/main/connection/ConnectionManager.ts`

> DB 依存のため単体テストは持たない（既存方針＝純粋関数にテストを集約）。検証は Step 3 の typecheck。

- [ ] **Step 1: メソッドを追加**

`src/main/connection/ConnectionManager.ts` の `applyChanges(...)` メソッドの直後（`isConnected()` の前）に、次のメソッドを追加する:

```ts
  // プールから1本取り、SELECT の行を逐次 onRow に渡す（ストリーミング）。
  // for await が行ごとにバックプレッシャを効かせる。onRow が投げたら中断し、必ず release する。
  async streamRows(
    sql: string,
    onRow: (row: Record<string, unknown>) => Promise<void>
  ): Promise<void> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    try {
      const stream = conn.connection.query(sql).stream()
      for await (const row of stream) {
        await onRow(row as Record<string, unknown>)
      }
    } finally {
      conn.release()
    }
  }
```

- [ ] **Step 2: 既存メソッドが無変更であることを確認**

`connect` / `query` / `listTables` / `primaryKey` / `applyChanges` / `isConnected` / `disconnect` は一切変更しないこと（`streamRows` の追加のみ）。

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで完了。

> もし `conn.connection` で型エラーが出る場合は、mysql2/promise の `PoolConnection` が公開する非promise コネクション（`.connection`）の型解決の問題。`conn.connection.query(sql).stream()` の戻りは Node の `Readable` で `for await` 可能。解決できない場合は BLOCKED で報告すること（勝手に別方式へ変えない）。

- [ ] **Step 4: コミット**

```bash
git add src/main/connection/ConnectionManager.ts
git commit -m "feat: ConnectionManager に行ストリーム取得 streamRows を追加"
```

---

## Task 3: `SqlDumper.dumpDatabase`（オーケストレータ）

**Files:**
- Create: `src/main/dump/SqlDumper.ts`

> DB 依存のため単体テストは持たない。検証は Step 2 の typecheck。

- [ ] **Step 1: 実装を書く**

Create `src/main/dump/SqlDumper.ts` with EXACTLY this content:

```ts
import type { ConnectionManager } from '../connection/ConnectionManager'
import { quoteIdent, buildDropAndCreate, buildInsert, dumpHeader, dumpFooter } from './sqlDumpHelpers'

export interface DumpResult {
  tableCount: number
  rowCount: number
}

// 1 つの INSERT にまとめる最大行数。
const BATCH_SIZE = 200

// 接続中 DB の全ベーステーブルを スキーマ＋データの SQL として write に流す。
export async function dumpDatabase(
  manager: ConnectionManager,
  write: (chunk: string) => void,
  generatedAt: string
): Promise<DumpResult> {
  const dbRes = await manager.query('SELECT DATABASE() AS db')
  const dbName = dbRes.rows[0]?.db
  if (dbName === null || dbName === undefined) {
    throw new Error('データベースが選択されていません')
  }
  write(dumpHeader(String(dbName), generatedAt))

  // ベーステーブルのみ列挙（ビュー等は対象外）。先頭列がテーブル名。
  const tablesRes = await manager.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
  const tables = tablesRes.rows
    .map((r) => String(Object.values(r)[0] ?? ''))
    .filter((t) => t.length > 0)

  let rowCount = 0
  for (const table of tables) {
    const createRes = await manager.query('SHOW CREATE TABLE ' + quoteIdent(table))
    const createSql = String(createRes.rows[0]?.['Create Table'] ?? '')
    write(buildDropAndCreate(table, createSql))
    write('\n')

    let columns: string[] | null = null
    let batch: Record<string, unknown>[] = []
    const flush = (): void => {
      if (columns && batch.length > 0) {
        write(buildInsert(table, columns, batch))
        batch = []
      }
    }
    await manager.streamRows('SELECT * FROM ' + quoteIdent(table), async (row) => {
      if (!columns) columns = Object.keys(row)
      batch.push(row)
      rowCount++
      if (batch.length >= BATCH_SIZE) flush()
    })
    flush()
    write('\n')
  }

  write(dumpFooter())
  return { tableCount: tables.length, rowCount }
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで完了。

- [ ] **Step 3: コミット**

```bash
git add src/main/dump/SqlDumper.ts
git commit -m "feat: SQL ダンプのオーケストレータ dumpDatabase を追加"
```

---

## Task 4: ネイティブメニューとエクスポート起動

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts`

> dialog / fs / Menu 依存のため単体テストは持たない。検証は Step 3 の typecheck。

- [ ] **Step 1: メニューとハンドラを作成**

Create `src/main/menu.ts` with EXACTLY this content:

```ts
import { Menu, dialog, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { createWriteStream } from 'fs'
import { once } from 'events'
import type { ConnectionManager } from './connection/ConnectionManager'
import { dumpDatabase } from './dump/SqlDumper'

// File →「SQLダンプをエクスポート…」の本体。接続確認 → 保存ダイアログ → ストリーム書き込み → 結果通知。
async function exportSqlDump(manager: ConnectionManager): Promise<void> {
  if (!manager.isConnected()) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'DB に接続していません',
      detail: '接続してから SQL ダンプを実行してください。'
    })
    return
  }

  // 既定ファイル名のため DB 名を取得（失敗時は dump で続行）。
  let dbName = 'dump'
  try {
    const res = await manager.query('SELECT DATABASE() AS db')
    const db = res.rows[0]?.db
    if (db) dbName = String(db)
  } catch {
    // ignore: 既定名で続行
  }

  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    defaultPath: `${dbName}.sql`,
    filters: [{ name: 'SQL', extensions: ['sql'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return

  const stream = createWriteStream(result.filePath, 'utf-8')
  try {
    const summary = await dumpDatabase(
      manager,
      (chunk) => stream.write(chunk),
      new Date().toISOString()
    )
    stream.end()
    await once(stream, 'finish')
    await dialog.showMessageBox({
      type: 'info',
      message: 'SQL ダンプを保存しました',
      detail: `${result.filePath}\n${summary.tableCount} テーブル / ${summary.rowCount} 行`
    })
  } catch (err) {
    stream.destroy()
    const message = err instanceof Error ? err.message : String(err)
    await dialog.showMessageBox({
      type: 'error',
      message: 'SQL ダンプに失敗しました',
      detail: `${message}\n部分的に書き込まれたファイルが残っている可能性があります。`
    })
  }
}

// App / File / Edit / View / Window のネイティブメニューを構築する。
export function buildAppMenu(manager: ConnectionManager): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'SQLダンプをエクスポート…',
          click: () => {
            void exportSqlDump(manager)
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
```

- [ ] **Step 2: メインで適用**

`src/main/index.ts` の electron import を `Menu` を含むように変更する:

```ts
import { app, BrowserWindow, Menu } from 'electron'
```

import 群（`./ipc/...` の近く）に追加:

```ts
import { buildAppMenu } from './menu'
```

`app.whenReady().then(() => { ... })` 内、`registerFileHandlers()` の直後・`createWindow()` の前に追加:

```ts
  Menu.setApplicationMenu(buildAppMenu(manager))
```

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで完了。

- [ ] **Step 4: コミット**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "feat: File メニューに SQL ダンプ エクスポートを追加"
```

---

## Task 5: 全体検証（型・テスト・手動確認）

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラーなしで完了。

- [ ] **Step 2: 全テスト**

Run: `npm test`
Expected: 全テスト PASS（`sqlDumpHelpers.test.ts` を含む。既存テストの退行なし）。

- [ ] **Step 3: 手動確認（開発ビルド）**

Run: `npm run dev`

確認項目:
- 接続前にメニューバー **File →「SQLダンプをエクスポート…」** をクリック → 「DB に接続していません」案内が出る。
- DB に接続後に同項目 → 保存ダイアログ（既定名 `<db名>.sql`）→ 保存。
- 生成された `.sql` の先頭に `SET NAMES utf8mb4;` / `SET FOREIGN_KEY_CHECKS=0;`、末尾に `=1;`。各テーブルに `DROP TABLE IF EXISTS` ＋ `CREATE TABLE` ＋ `INSERT`。
- 別 DB（空）に対して保存した `.sql` を流し込み、テーブルとデータが復元できる（FK のあるスキーマでも順序に関係なく通る）。
- NULL・日本語・カンマ・改行・引用符・バイナリ列を含む値が壊れず復元できる。
- メニュー新設後も Edit のコピー/ペースト・View の DevTools 等が機能する。
- 保存ダイアログのキャンセルで何も起きない。

- [ ] **Step 4: 完了**

問題なければ `superpowers:finishing-a-development-branch` で統合方法（マージ/PR）を選ぶ。

---

## Self-Review メモ

- **Spec 網羅:** 値エスケープ規則＝Task 1（`escapeSqlValue`）、INSERT/DDL/ヘッダ/フッタ＝Task 1、行ストリーミング＝Task 2（`streamRows`）、ベーステーブル列挙＋バッチ＝Task 3、File メニュー新設＋標準ロール＝Task 4、保存ダイアログ＋結果/エラーダイアログ＋未接続/DB未選択処理＝Task 4・Task 3、メニュー適用＝Task 4、テスト集約方針＝各タスク注記。スコープ外（ビュー等）は対象外として未実装。
- **型整合:** `dumpDatabase(manager, write: (chunk: string) => void, generatedAt: string): Promise<DumpResult>`、`DumpResult { tableCount; rowCount }`、`streamRows(sql, onRow: (row) => Promise<void>)`、ヘルパー関数名（`quoteIdent`/`escapeSqlValue`/`buildInsert`/`buildDropAndCreate`/`dumpHeader`/`dumpFooter`）が Task 1/3/4 で一致。
- **プレースホルダ:** なし（全ステップに実コード）。
