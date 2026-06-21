import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { createGunzip } from 'zlib'
import { Transform } from 'stream'
import { StringDecoder } from 'string_decoder'
import type { ImportSummary, ImportProgress } from '../../shared/types'
import { SqlStatementSplitter } from './sqlStatementSplitter'
import { isGzipFile } from './gzip'
import { t } from '../i18n'

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
  const gzip = await isGzipFile(filePath)
  const start = Date.now()
  let executedCount = 0
  let bytesRead = 0
  let failure: ImportSummary['failure'] | undefined

  await manager.withDedicatedConnection(async (exec) => {
    // import 中は外部キー制約を無効化する。dump 内の DROP/CREATE/INSERT が
    // テーブル定義順や循環参照に依存せず通るようにするため。dedicated 接続の
    // セッション変数なので以降の全 statement に効く。
    // ※ executedCount には含めない（dump 由来の文ではないので runOne を通さない）。
    await exec('SET FOREIGN_KEY_CHECKS=0')

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
        throw new Error(t('error.gzipDecompressFailed'))
      }
      throw err
    } finally {
      // raw を destroy すれば pipe 先の counter/gunzip も連鎖して破棄される。
      // 途中 return（stop-on-error）や例外時は async iterator の teardown が textSource を閉じる。
      raw.destroy()
      // 接続をプールへ返す前に FK チェックを復帰する（次の借り手へ無効状態を漏らさない）。
      // 復帰自体の失敗で元の例外やサマリを覆い隠さないよう握りつぶす。
      try {
        await exec('SET FOREIGN_KEY_CHECKS=1')
      } catch {
        // ignore
      }
    }
  })

  return {
    status: failure ? 'failed' : 'completed',
    executedCount,
    durationMs: Date.now() - start,
    ...(failure ? { failure } : {})
  }
}
