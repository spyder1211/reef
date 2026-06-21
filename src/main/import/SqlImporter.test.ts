import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeFileSync, rmSync, statSync } from 'fs'
import { gzipSync } from 'zlib'
import { join } from 'path'
import { tmpdir } from 'os'
import { importSqlDump, type ImportExecutor } from './SqlImporter'

const tmpFiles: string[] = []
function writeTmp(name: string, content: string): string {
  const p = join(tmpdir(), `reef-import-test-${name}-${process.pid}.sql`)
  writeFileSync(p, content, 'utf-8')
  tmpFiles.push(p)
  return p
}
// gzip 圧縮した .sql.gz の一時ファイルを書き出す。
function writeTmpGz(name: string, content: string): string {
  const p = join(tmpdir(), `reef-import-test-${name}-${process.pid}.sql.gz`)
  writeFileSync(p, gzipSync(Buffer.from(content, 'utf-8')))
  tmpFiles.push(p)
  return p
}
// 生バイトをそのまま .sql.gz として書き出す（壊れた gzip の検証用）。
function writeTmpRawGz(name: string, buf: Buffer): string {
  const p = join(tmpdir(), `reef-import-test-${name}-${process.pid}.sql.gz`)
  writeFileSync(p, buf)
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

// SET FOREIGN_KEY_CHECKS の内部文を除いた、dump 由来の exec 呼び出しだけを取り出す。
function dumpCalls(exec: ReturnType<typeof vi.fn>): string[] {
  return exec.mock.calls
    .map((c) => c[0] as string)
    .filter((s) => !s.startsWith('SET FOREIGN_KEY_CHECKS'))
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
    expect(dumpCalls(exec)).toHaveLength(2)
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
    // 3 文目は実行されない（dump 由来は CREATE と bad の 2 文のみ）
    expect(dumpCalls(exec)).toHaveLength(2)
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

  it('gzip 圧縮された .sql.gz を展開して逐次実行する', async () => {
    const sql = 'CREATE TABLE t (id INT);\nINSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);\n'
    const file = writeTmpGz('gz', sql)
    const { exec, manager } = fakeExecutor()
    const summary = await importSqlDump(manager, file, vi.fn())
    expect(summary.status).toBe('completed')
    expect(summary.executedCount).toBe(3)
    expect(dumpCalls(exec)).toHaveLength(3)
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
    expect(dumpCalls(exec)[0]).toContain('日本語テスト')
  })

  it('壊れた gzip は専用エラーメッセージで reject する', async () => {
    // gzip マジックバイト + 妥当なヘッダ10バイトの後に不正な deflate データ → 展開時に Z_DATA_ERROR。
    const corrupt = Buffer.concat([
      Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]),
      Buffer.from('this is not valid deflate data')
    ])
    const file = writeTmpRawGz('gzbad', corrupt)
    const { exec, manager } = fakeExecutor()
    await expect(importSqlDump(manager, file, vi.fn())).rejects.toThrow(
      'Failed to decompress gzip'
    )
    // 展開に失敗するため dump の文は 1 つも実行されない（SET 文以外は呼ばれない）。
    expect(dumpCalls(exec)).toHaveLength(0)
  })

  it('import 開始時に FK チェックを無効化し、終了時に復帰する', async () => {
    const file = writeTmp('fk', 'INSERT INTO t VALUES (1);\n')
    const { exec, manager } = fakeExecutor()
    const summary = await importSqlDump(manager, file, vi.fn())
    expect(summary.status).toBe('completed')
    // SET 文は dump 由来ではないため executedCount に含めない。
    expect(summary.executedCount).toBe(1)
    const calls = exec.mock.calls.map((c) => c[0])
    expect(calls[0]).toBe('SET FOREIGN_KEY_CHECKS=0')
    expect(calls[calls.length - 1]).toBe('SET FOREIGN_KEY_CHECKS=1')
  })

  it('途中失敗でも FK チェックを復帰してから終了する', async () => {
    const file = writeTmp('fkfail', 'INSERT INTO bad VALUES (1);\nINSERT INTO t VALUES (2);\n')
    const { exec, manager } = fakeExecutor({ failOn: 'INSERT INTO bad' })
    const summary = await importSqlDump(manager, file, vi.fn())
    expect(summary.status).toBe('failed')
    const calls = exec.mock.calls.map((c) => c[0])
    expect(calls[0]).toBe('SET FOREIGN_KEY_CHECKS=0')
    expect(calls).toContain('SET FOREIGN_KEY_CHECKS=1')
  })
})
