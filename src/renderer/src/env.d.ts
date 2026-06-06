/// <reference types="vite/client" />
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput
} from '../../shared/types'

declare global {
  interface Window {
    api: {
      connect: (config: ConnectionConfig) => Promise<ApiResult<null>>
      query: (sql: string) => Promise<ApiResult<QueryResult>>
      disconnect: () => Promise<ApiResult<null>>
      listTables: () => Promise<ApiResult<string[]>>
      connections: {
        list: () => Promise<ApiResult<ConnectionProfile[]>>
        save: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
        delete: (id: string) => Promise<ApiResult<null>>
        connect: (id: string) => Promise<ApiResult<null>>
      }
    }
  }
}
