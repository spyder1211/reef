import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionConfig,
  ApiResult,
  QueryResult,
  ConnectionProfile,
  ConnectionProfileInput
} from '../shared/types'

const api = {
  connect: (config: ConnectionConfig): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:connect', config),
  query: (sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:query', sql, params),
  disconnect: (): Promise<ApiResult<null>> => ipcRenderer.invoke('db:disconnect'),
  listTables: (): Promise<ApiResult<string[]>> => ipcRenderer.invoke('db:listTables'),
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
