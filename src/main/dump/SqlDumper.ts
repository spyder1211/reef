import type { ConnectionManager } from '../connection/ConnectionManager'
import { t } from '../i18n'
import {
  buildDropAndCreate,
  buildInsert,
  dumpFooter,
  dumpHeader,
  quoteIdent
} from './sqlDumpHelpers'

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
    throw new Error(t('error.noDatabaseSelected'))
  }
  write(dumpHeader(String(dbName), generatedAt))

  // ベーステーブルのみ列挙（ビュー等は対象外）。先頭列がテーブル名。
  const tablesRes = await manager.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
  const tables = tablesRes.rows
    .map((r) => String(Object.values(r)[0] ?? ''))
    .filter((t) => t.length > 0)

  let rowCount = 0
  for (const table of tables) {
    const createRes = await manager.query(`SHOW CREATE TABLE ${quoteIdent(table)}`)
    const createSql = String(createRes.rows[0]?.['Create Table'] ?? '')
    if (!createSql) {
      throw new Error(t('error.showCreateTableEmpty', { table: quoteIdent(table) }))
    }
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
    await manager.streamRows(`SELECT * FROM ${quoteIdent(table)}`, async (row) => {
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
