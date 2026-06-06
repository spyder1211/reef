/// <reference types="vite/client" />
import type { ConnectionConfig, ApiResult, QueryResult } from '../../shared/types'

declare global {
  interface Window {
    api: {
      connect: (config: ConnectionConfig) => Promise<ApiResult<null>>
      query: (sql: string) => Promise<ApiResult<QueryResult>>
      disconnect: () => Promise<ApiResult<null>>
    }
  }
}
