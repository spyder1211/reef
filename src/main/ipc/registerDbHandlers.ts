import { ipcMain } from 'electron'
import { ConnectionManager } from '../connection/ConnectionManager'
import { QueryHistoryStore } from '../history/QueryHistoryStore'
import { validateConnectionConfig } from '../connection/validateConnectionConfig'
import { normalizeDbError } from '../connection/normalizeDbError'
import { QueryCancelledError } from '../connection/queryCancellation'
import { connectWithTunnel, closeTunnel, type TunnelHolder } from '../connection/connectWithTunnel'
import { clearProductionContext } from '../connection/productionContext'
import { guardProductionSql, guardProductionTier } from '../guard/productionGuard'
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  SqlStatement,
  TableSchema,
  QueryHistoryEntry
} from '../../shared/types'

export function registerDbHandlers(
  manager: ConnectionManager,
  history: QueryHistoryStore,
  tunnel: TunnelHolder
): void {
  // 本番ガードでキャンセルされた時の戻り値（renderer は code==='CANCELLED' を静かに扱う）。
  const CANCELLED = { ok: false as const, error: { code: 'CANCELLED', message: '' } }

  ipcMain.handle(
    'db:connect',
    async (_e, config: ConnectionConfig): Promise<ApiResult<null>> => {
      const errors = validateConnectionConfig(config)
      if (errors.length > 0) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: errors.join(', ') } }
      }
      try {
        await connectWithTunnel(manager, config, tunnel)
        clearProductionContext() // テスト接続はタグ不明のため非 production 扱い
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'db:query',
    async (e, tabId: string, sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      try {
        return { ok: true, data: await manager.query(sql, params, tabId) }
      } catch (err) {
        if (err instanceof QueryCancelledError) return CANCELLED
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'db:queryScript',
    async (e, tabId: string, sql: string): Promise<ApiResult<QueryResult>> => {
      if (!(await guardProductionSql(e, sql, 'SQL の実行'))) return CANCELLED
      // キャンセル（実行前ガード／実行中 KILL）は履歴に残さない。成功/失敗時のみ history.add。
      try {
        const data = await manager.queryScript(sql, tabId)
        history.add({ sql, durationMs: data.durationMs, ok: true })
        return { ok: true, data }
      } catch (err) {
        if (err instanceof QueryCancelledError) return CANCELLED
        const error = normalizeDbError(err)
        history.add({ sql, durationMs: 0, ok: false, errorMessage: error.message })
        return { ok: false, error }
      }
    }
  )

  // 実行中クエリの停止。自分のクエリの KILL QUERY は破壊的でないので本番ガードは通さない。
  ipcMain.handle('db:cancel', async (_e, tabId: string): Promise<ApiResult<null>> => {
    try {
      await manager.cancel(tabId)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('db:disconnect', async (): Promise<ApiResult<null>> => {
    clearProductionContext() // 切断時は本番判定を必ず落とす（pool.end 失敗時も残さない）
    try {
      await manager.disconnect()
      await closeTunnel(tunnel) // DB 切断後に SSH トンネルも閉じる（接続一覧へ戻る時も同経路）
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('db:listTables', async (): Promise<ApiResult<string[]>> => {
    try {
      return { ok: true, data: await manager.listTables() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle(
    'db:primaryKey',
    async (_e, table: string): Promise<ApiResult<string[]>> => {
      try {
        return { ok: true, data: await manager.primaryKey(table) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'db:autoIncrementColumns',
    async (_e, table: string): Promise<ApiResult<string[]>> => {
      try {
        return { ok: true, data: await manager.autoIncrementColumns(table) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'db:tableSchema',
    async (_e, table: string): Promise<ApiResult<TableSchema>> => {
      try {
        return { ok: true, data: await manager.tableSchema(table) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('db:schemaMap', async (): Promise<ApiResult<Record<string, string[]>>> => {
    try {
      return { ok: true, data: await manager.schemaMap() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle(
    'db:applyChanges',
    async (e, statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> => {
      if (!(await guardProductionTier(e, 'write', '変更の適用（コミット）'))) return CANCELLED
      try {
        return { ok: true, data: await manager.applyChanges(statements) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('history:list', async (): Promise<ApiResult<QueryHistoryEntry[]>> => {
    return { ok: true, data: history.list() }
  })

  ipcMain.handle('history:clear', async (): Promise<ApiResult<null>> => {
    history.clear()
    return { ok: true, data: null }
  })
}
