import { ipcMain } from 'electron'
import { ConnectionManager } from '../connection/ConnectionManager'
import { validateConnectionConfig } from '../connection/validateConnectionConfig'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ConnectionConfig, ApiResult, QueryResult, SqlStatement } from '../../shared/types'

export function registerDbHandlers(manager: ConnectionManager): void {
  ipcMain.handle(
    'db:connect',
    async (_e, config: ConnectionConfig): Promise<ApiResult<null>> => {
      const errors = validateConnectionConfig(config)
      if (errors.length > 0) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: errors.join(', ') } }
      }
      try {
        await manager.connect(config)
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'db:query',
    async (_e, sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> => {
      try {
        return { ok: true, data: await manager.query(sql, params) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('db:disconnect', async (): Promise<ApiResult<null>> => {
    try {
      await manager.disconnect()
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
    'db:applyChanges',
    async (_e, statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> => {
      try {
        return { ok: true, data: await manager.applyChanges(statements) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )
}
