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
