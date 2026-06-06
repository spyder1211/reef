import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionConfig, ApiResult, QueryResult } from '../shared/types'

const api = {
  connect: (config: ConnectionConfig): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:connect', config),
  query: (sql: string): Promise<ApiResult<QueryResult>> => ipcRenderer.invoke('db:query', sql),
  disconnect: (): Promise<ApiResult<null>> => ipcRenderer.invoke('db:disconnect')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
