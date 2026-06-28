import type { Connection as Mysql2Connection } from 'mysql2'
import mysql from 'mysql2/promise'
import { MAX_RESULT_ROWS } from '../../shared/queryLimits'
import type { ConnectionConfig, QueryResult, SqlStatement, TableSchema } from '../../shared/types'
import { SqlStatementSplitter } from '../import/sqlStatementSplitter'
import { maybeApplyAutoLimit } from './autoLimit'
import { extractTableNames } from './extractTableNames'
import { fieldTypeName } from './mysqlTypes'
import { extractRows } from './resultRows'
import { isQueryInterrupted, QueryCancelledError } from './queryCancellation'

export class ConnectionManager {
  private pool: mysql.Pool | null = null

  // tabId → 実行中クエリの MySQL スレッドID。cancel() の KILL QUERY 対象を引くため。
  private runningQueries = new Map<string, number>()

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

  async query(sql: string, params?: unknown[], tabId?: string): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    if (tabId) return this.runCancellable(tabId, (conn) => this.runOne(conn, sql, params))
    return this.runOne(this.pool, sql, params)
  }

  // execer（Pool でも PoolConnection でも可）で1文実行し QueryResult へ整形する。
  private async runOne(
    execer: mysql.Pool | mysql.PoolConnection,
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult> {
    const start = Date.now()
    const [rows, fields] = await execer.query(sql, params)
    const durationMs = Date.now() - start
    const { dataRows, affectedRows } = extractRows(rows)
    const columns = (fields ?? []).map((f) => {
      const ff = f as { name: string; type?: number }
      return {
        name: ff.name,
        type: typeof ff.type === 'number' ? fieldTypeName(ff.type) : undefined
      }
    })
    const result: QueryResult = { columns, rows: dataRows, rowCount: dataRows.length, durationMs }
    if (affectedRows !== undefined) result.affectedRows = affectedRows
    return result
  }

  // tabId 付きクエリを pool の専用接続で実行し、threadId を登録する。
  // 中断（KILL QUERY）された文は QueryCancelledError に翻訳する。
  // KILL QUERY は接続を殺さないので finally は release（destroy ではない）。
  private async runCancellable<T>(
    tabId: string,
    fn: (conn: mysql.PoolConnection) => Promise<T>
  ): Promise<T> {
    if (!this.pool) throw new Error('Not connected')
    const conn = await this.pool.getConnection()
    try {
      let threadId = conn.threadId
      if (threadId == null) {
        const [rows] = await conn.query('SELECT CONNECTION_ID() AS id')
        threadId = Number((rows as Array<{ id: number }>)[0]?.id)
      }
      this.runningQueries.set(tabId, threadId)
      return await fn(conn)
    } catch (err) {
      if (isQueryInterrupted(err)) throw new QueryCancelledError()
      throw err
    } finally {
      this.runningQueries.delete(tabId)
      conn.release()
    }
  }

  // 実行中クエリを別接続から KILL QUERY で中断する。実行中でなければ no-op。
  async cancel(tabId: string): Promise<void> {
    const threadId = this.runningQueries.get(tabId)
    if (threadId == null || !this.pool) return
    await this.pool.query('KILL QUERY ?', [threadId])
  }

  // SQL エディタ用：入力全体を ; で文単位に分割し、先頭から順に実行する。
  // mysql2 の multipleStatements は無効なので、1回の Cmd+Enter で複数文を流すにはここで分割する。
  // 表示するのは最後の文の結果（複数 SELECT のうち最後）。所要時間は全文の合計。
  // 途中の文が失敗したら即 throw し、以降の文は実行しない（autocommit のため既実行分は確定済み）。
  // ※ splitter はコメントを除去するため、実行 SQL からコメントは取り除かれる。
  async queryScript(
    sql: string,
    tabId?: string,
    opts?: { skipAutoLimit?: boolean }
  ): Promise<QueryResult> {
    if (!this.pool) throw new Error('Not connected')
    const splitter = new SqlStatementSplitter()
    const statements = [...splitter.push(sql), ...splitter.end()]
    if (statements.length === 0) return { columns: [], rows: [], rowCount: 0, durationMs: 0 }
    if (tabId) return this.runCancellable(tabId, (conn) => this.runScript(conn, statements, opts))
    return this.runScript(this.pool, statements, opts)
  }

  // 分割済みの文を execer 上で順次実行し、最後の文の結果＋全体所要時間を返す。
  // 単一の素SELECT（!skipAutoLimit）には LIMIT 500 を自動付与し autoLimited を立てる。
  // 最終結果が MAX_RESULT_ROWS を超えたら slice して truncated を立てる（SQLタブ専用ガード）。
  private async runScript(
    execer: mysql.Pool | mysql.PoolConnection,
    statements: string[],
    opts?: { skipAutoLimit?: boolean }
  ): Promise<QueryResult> {
    const start = Date.now()
    let last: QueryResult = { columns: [], rows: [], rowCount: 0, durationMs: 0 }
    const useAutoLimit = statements.length === 1 && !opts?.skipAutoLimit
    let autoLimited = false
    for (const stmt of statements) {
      let toRun = stmt
      if (useAutoLimit) {
        const r = maybeApplyAutoLimit(stmt, statements.length)
        toRun = r.sql
        autoLimited = r.applied
      }
      last = await this.runOne(execer, toRun)
    }
    let rows = last.rows
    let truncated = false
    if (rows.length > MAX_RESULT_ROWS) {
      rows = rows.slice(0, MAX_RESULT_ROWS)
      truncated = true
    }
    const result: QueryResult = {
      ...last,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - start
    }
    if (autoLimited) result.autoLimited = true
    if (truncated) result.truncated = true
    return result
  }

  async listTables(): Promise<string[]> {
    const { rows } = await this.query('SHOW TABLES')
    return extractTableNames(rows)
  }

  // 主キー列名を Seq_in_index 順で返す。主キーがなければ []（複合主キー対応）。
  async primaryKey(table: string): Promise<string[]> {
    if (!this.pool) throw new Error('Not connected')
    const quoted = `\`${table.replace(/`/g, '``')}\``
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
    const quoted = `\`${table.replace(/`/g, '``')}\``
    const [rows] = await this.pool.query(`SHOW COLUMNS FROM ${quoted}`)
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
    return list
      .filter((r) =>
        String(r.Extra ?? '')
          .toLowerCase()
          .includes('auto_increment')
      )
      .map((r) => String(r.Field))
  }

  // テーブル構造（カラム・インデックス・DDL）をまとめて取得する（Structure ビュー用）。
  async tableSchema(table: string): Promise<TableSchema> {
    if (!this.pool) throw new Error('Not connected')
    const quoted = `\`${table.replace(/`/g, '``')}\``

    const [colRows] = await this.pool.query(`SHOW FULL COLUMNS FROM ${quoted}`)
    const columns = (Array.isArray(colRows) ? (colRows as Record<string, unknown>[]) : []).map(
      (r) => ({
        name: String(r.Field),
        type: String(r.Type),
        nullable: String(r.Null).toUpperCase() === 'YES',
        key: String(r.Key ?? ''),
        default: r.Default === null || r.Default === undefined ? null : String(r.Default),
        extra: String(r.Extra ?? ''),
        comment: String(r.Comment ?? '')
      })
    )

    const [idxRows] = await this.pool.query(`SHOW INDEX FROM ${quoted}`)
    const idxList = Array.isArray(idxRows) ? (idxRows as Record<string, unknown>[]) : []
    const byName = new Map<string, { unique: boolean; cols: { seq: number; col: string }[] }>()
    for (const r of idxList) {
      const name = String(r.Key_name)
      const entry = byName.get(name) ?? { unique: Number(r.Non_unique) === 0, cols: [] }
      entry.cols.push({ seq: Number(r.Seq_in_index), col: String(r.Column_name) })
      byName.set(name, entry)
    }
    const indexes = [...byName.entries()].map(([name, e]) => ({
      name,
      unique: e.unique,
      columns: e.cols.sort((a, b) => a.seq - b.seq).map((c) => c.col)
    }))

    const [ddlRows] = await this.pool.query(`SHOW CREATE TABLE ${quoted}`)
    const ddlRow = (Array.isArray(ddlRows) ? (ddlRows as Record<string, unknown>[]) : [])[0]
    const ddl = String(ddlRow?.['Create Table'] ?? '')

    return { columns, indexes, ddl }
  }

  // SQL 補完用：接続中 DB の { テーブル名: カラム名[] } を一括取得する。
  async schemaMap(): Promise<Record<string, string[]>> {
    if (!this.pool) throw new Error('Not connected')
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION`
    )
    const map: Record<string, string[]> = {}
    for (const r of Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []) {
      const t = String(r.t)
      if (!map[t]) map[t] = []
      map[t].push(String(r.c))
    }
    return map
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
