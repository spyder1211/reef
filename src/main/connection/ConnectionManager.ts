import mysql from 'mysql2/promise'
import type { ConnectionConfig, QueryResult } from '../../shared/types'
import { extractTableNames } from './extractTableNames'

export class ConnectionManager {
  private pool: mysql.Pool | null = null

  async connect(config: ConnectionConfig): Promise<void> {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5,
      // DATE/DATETIME/TIMESTAMP を Date ではなく保存文字列のまま返す（例: "2025-09-26 16:17:05"）
      dateStrings: true
    })
    // 実際に1本取得して疎通を確認（認証エラー等をここで顕在化）
    const conn = await this.pool.getConnection()
    conn.release()
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const start = Date.now()
    const [rows, fields] = await this.pool.query(sql, params)
    const durationMs = Date.now() - start
    const dataRows = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    const columns = (fields ?? []).map((f) => ({ name: (f as { name: string }).name }))
    return { columns, rows: dataRows, rowCount: dataRows.length, durationMs }
  }

  async listTables(): Promise<string[]> {
    const { rows } = await this.query('SHOW TABLES')
    return extractTableNames(rows)
  }

  isConnected(): boolean {
    return this.pool !== null
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end()
      this.pool = null
    }
  }
}
