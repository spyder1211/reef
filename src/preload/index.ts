import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput,
  SqlStatement
} from '../shared/types'

const api = {
  connect: (config: ConnectionConfig): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:connect', config),
  query: (sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:query', sql, params),
  disconnect: (): Promise<ApiResult<null>> => ipcRenderer.invoke('db:disconnect'),
  listTables: (): Promise<ApiResult<string[]>> => ipcRenderer.invoke('db:listTables'),
  primaryKey: (table: string): Promise<ApiResult<string[]>> =>
    ipcRenderer.invoke('db:primaryKey', table),
  applyChanges: (statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> =>
    ipcRenderer.invoke('db:applyChanges', statements),
  connections: {
    list: (): Promise<ApiResult<ConnectionProfile[]>> => ipcRenderer.invoke('connections:list'),
    save: (input: ConnectionProfileInput): Promise<ApiResult<ConnectionProfile>> =>
      ipcRenderer.invoke('connections:save', input),
    delete: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:delete', id),
    connect: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:connect', id)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
