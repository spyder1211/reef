import mysql from 'mysql2/promise'
import type { Connection as Mysql2Connection } from 'mysql2'
import type { ConnectionConfig, QueryResult, SqlStatement } from '../../shared/types'
import { extractTableNames } from './extractTableNames'
import { fieldTypeName } from './mysqlTypes'

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
    const columns = (fields ?? []).map((f) => {
      const ff = f as { name: string; type?: number }
      return { name: ff.name, type: typeof ff.type === 'number' ? fieldTypeName(ff.type) : undefined }
    })
    return { columns, rows: dataRows, rowCount: dataRows.length, durationMs }
  }

  async listTables(): Promise<string[]> {
    const { rows } = await this.query('SHOW TABLES')
    return extractTableNames(rows)
  }

  // 主キー列名を Seq_in_index 順で返す。主キーがなければ []（複合主キー対応）。
  async primaryKey(table: string): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected')
    const quoted = '`' + table.replace(/`/g, '``') + '`'
    const [rows] = await this.pool.query(`SHOW KEYS FROM ${quoted} WHERE Key_name = 'PRIMARY'`)
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    return list
      .sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index))
      .map((r) => String(r.Column_name))
  }

  // auto_increment 属性を持つ列名を返す（複製時に除外して自動採番させるため）。
  // 接続中の DB スコープ。該当無しなら []。
  async autoIncrementColumns(table: string): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected')
    const quoted = '`' + table.replace(/`/g, '``') + '`'
    const [rows] = await this.pool.query(`SHOW COLUMNS FROM ${quoted}`)
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    return list
      .filter((r) => String(r.Extra ?? '').toLowerCase().includes('auto_increment'))
      .map((r) => String(r.Field))
  }

  // 複数の文を1トランザクションで適用。1つでも失敗したら全ロールバックして再 throw。
  async applyChanges(statements: SqlStatement[]): Promise<{ affectedRows: number }> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    try {
      await conn.beginTransaction()
      let affectedRows = 0
      for (const s of statements) {
        const [result] = await conn.query(s.sql, s.params)
        affectedRows += (result as { affectedRows?: number }).affectedRows ?? 0
      }
      await conn.commit()
      return { affectedRows }
    } catch (err) {
      // rollback 自体が投げても元のエラーを優先して返す
      try {
        await conn.rollback()
      } catch {
        // ignore
      }
      throw err
    } finally {
      conn.release()
    }
  }

  // プールから1本取り、SELECT の行を逐次 onRow に渡す（ストリーミング）。
  // for await が行ごとにバックプレッシャを効かせる。onRow が投げたら中断する。
  // 正常終了時は接続を release してプールへ戻し、異常終了時は destroy してプールから除外する。
  async streamRows(
    sql: string,
    onRow: (row: Record<string, unknown>) => Promise<void>
  ): Promise<void> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    try {
      // conn.connection は型上 promise 版 Connection だが、実体はコールバック版で
      // .query().stream()（Node Readable）を持つ。そのためコールバック版型へキャストする。
      const core = conn.connection as unknown as Mysql2Connection
      const stream = core.query(sql).stream()
      for await (const row of stream) {
        await onRow(row as Record<string, unknown>)
      }
    } catch (err) {
      // onRow/ストリームが異常終了した場合、in-flight クエリが残った接続を
      // プールへ戻すと次の借り手で protocol desync を起こし得るため、破棄する。
      conn.destroy()
      throw err
    }
    conn.release()
  }

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
