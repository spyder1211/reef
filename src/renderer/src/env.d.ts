/// <reference types="vite/client" />
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement,
  SaveFileResult
} from '../../shared/types'

declare global {
  interface Window {
    api: {
      connect: (config: ConnectionConfig) => Promise<ApiResult<null>>
      query: (sql: string, params?: unknown[]) => Promise<ApiResult<QueryResult>>
      disconnect: () => Promise<ApiResult<null>>
      listTables: () => Promise<ApiResult<string[]>>
      primaryKey: (table: string) => Promise<ApiResult<string[]>>
      applyChanges: (statements: SqlStatement[]) => Promise<ApiResult<{ affectedRows: number }>>
      saveCsv: (defaultFileName: string, content: string) => Promise<ApiResult<SaveFileResult>>
      onReturnToConnections: (cb: () => void) => () => void
      connections: {
        list: () => Promise<ApiResult<ConnectionProfile[]>>
        save: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
        delete: (id: string) => Promise<ApiResult<null>>
        connect: (id: string) => Promise<ApiResult<null>>
      }
    }
  }
}
