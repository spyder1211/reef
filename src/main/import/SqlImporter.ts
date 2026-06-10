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
