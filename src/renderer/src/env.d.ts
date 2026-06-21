/// <reference types="vite/client" />
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  ConnectionGroup,
  SqlStatement,
  SaveFileResult,
  ImportSummary,
  ImportProgress,
  SqlImportRequest,
  TableSchema,
  QueryHistoryEntry
} from '../../shared/types'
import type { Locale, LocalePreference } from '../../shared/i18n/types'

declare global {
  // electron.vite.config.ts の define で package.json の version を埋め込む。
  const __APP_VERSION__: string

  interface Window {
    api: {
      connect: (config: ConnectionConfig) => Promise<ApiResult<null>>
      query: (tabId: string, sql: string, params?: unknown[]) => Promise<ApiResult<QueryResult>>
      queryScript: (tabId: string, sql: string, skipAutoLimit?: boolean) => Promise<ApiResult<QueryResult>>
      cancelQuery: (tabId: string) => Promise<ApiResult<null>>
      disconnect: () => Promise<ApiResult<null>>
      listTables: () => Promise<ApiResult<string[]>>
      primaryKey: (table: string) => Promise<ApiResult<string[]>>
      autoIncrementColumns: (table: string) => Promise<ApiResult<string[]>>
      tableSchema: (table: string) => Promise<ApiResult<TableSchema>>
      schemaMap: () => Promise<ApiResult<Record<string, string[]>>>
      applyChanges: (statements: SqlStatement[]) => Promise<ApiResult<{ affectedRows: number }>>
      saveCsv: (defaultFileName: string, content: string) => Promise<ApiResult<SaveFileResult>>
      pickPrivateKey: () => Promise<ApiResult<SaveFileResult>>
      onReturnToConnections: (cb: () => void) => () => void
      onReloadActiveTab: (cb: () => void) => () => void
      sqlImport: {
        onRequest: (cb: (req: SqlImportRequest) => void) => () => void
        start: () => Promise<ApiResult<ImportSummary>>
        onProgress: (cb: (p: ImportProgress) => void) => () => void
      }
      connections: {
        list: () => Promise<ApiResult<ConnectionProfile[]>>
        save: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
        duplicate: (id: string) => Promise<ApiResult<ConnectionProfile>>
        delete: (id: string) => Promise<ApiResult<null>>
        connect: (id: string) => Promise<ApiResult<null>>
        move: (profileId: string, groupId: string | null) => Promise<ApiResult<null>>
        isEncryptionAvailable: () => Promise<ApiResult<boolean>>
      }
      groups: {
        list: () => Promise<ApiResult<ConnectionGroup[]>>
        create: (name: string) => Promise<ApiResult<ConnectionGroup>>
        rename: (id: string, name: string) => Promise<ApiResult<null>>
        delete: (id: string) => Promise<ApiResult<null>>
        reorder: (orderedIds: string[]) => Promise<ApiResult<null>>
      }
      history: {
        list: () => Promise<ApiResult<QueryHistoryEntry[]>>
        clear: () => Promise<ApiResult<null>>
      }
      i18n: {
        bootstrap: { systemLocale: Locale; preference: LocalePreference; effective: Locale }
        setLocale: (preference: LocalePreference) => Promise<{ effective: Locale }>
      }
    }
  }
}
