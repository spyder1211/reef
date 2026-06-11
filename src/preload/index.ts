import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
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
  SqlImportRequest
} from '../shared/types'

const api = {
  connect: (config: ConnectionConfig): Promise<ApiResult<null>> =>
    ipcRenderer.invoke('db:connect', config),
  query: (sql: string, params?: unknown[]): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:query', sql, params),
  // SQL エディタ用：複数文を ; で分割して順に実行（main 側）。
  queryScript: (sql: string): Promise<ApiResult<QueryResult>> =>
    ipcRenderer.invoke('db:queryScript', sql),
  disconnect: (): Promise<ApiResult<null>> => ipcRenderer.invoke('db:disconnect'),
  listTables: (): Promise<ApiResult<string[]>> => ipcRenderer.invoke('db:listTables'),
  primaryKey: (table: string): Promise<ApiResult<string[]>> =>
    ipcRenderer.invoke('db:primaryKey', table),
  autoIncrementColumns: (table: string): Promise<ApiResult<string[]>> =>
    ipcRenderer.invoke('db:autoIncrementColumns', table),
  applyChanges: (statements: SqlStatement[]): Promise<ApiResult<{ affectedRows: number }>> =>
    ipcRenderer.invoke('db:applyChanges', statements),
  saveCsv: (defaultFileName: string, content: string): Promise<ApiResult<SaveFileResult>> =>
    ipcRenderer.invoke('file:saveCsv', defaultFileName, content),
  // ウィンドウの閉じる操作で接続中に発火。登録解除関数を返す（React のクリーンアップ用）。
  onReturnToConnections: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:return-to-connections', handler)
    return () => ipcRenderer.removeListener('app:return-to-connections', handler)
  },
  // View →「再読み込み」(Cmd+R) で発火。アクティブタブのクエリ/テーブルを再実行する。
  // 登録解除関数を返す（React のクリーンアップ用）。
  onReloadActiveTab: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:reload-active-tab', handler)
    return () => ipcRenderer.removeListener('app:reload-active-tab', handler)
  },
  sqlImport: {
    // File メニューからの開始要求を購読。登録解除関数を返す。
    onRequest: (cb: (req: SqlImportRequest) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, req: SqlImportRequest): void => cb(req)
      ipcRenderer.on('app:sql-import-request', handler)
      return () => ipcRenderer.removeListener('app:sql-import-request', handler)
    },
    // 保留中のファイルを実行（パスは渡さない）。
    start: (): Promise<ApiResult<ImportSummary>> => ipcRenderer.invoke('sqlImport:start'),
    // 進捗を購読。登録解除関数を返す。
    onProgress: (cb: (p: ImportProgress) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, p: ImportProgress): void => cb(p)
      ipcRenderer.on('app:sql-import-progress', handler)
      return () => ipcRenderer.removeListener('app:sql-import-progress', handler)
    }
  },
  connections: {
    list: (): Promise<ApiResult<ConnectionProfile[]>> => ipcRenderer.invoke('connections:list'),
    save: (input: ConnectionProfileInput): Promise<ApiResult<ConnectionProfile>> =>
      ipcRenderer.invoke('connections:save', input),
    duplicate: (id: string): Promise<ApiResult<ConnectionProfile>> =>
      ipcRenderer.invoke('connections:duplicate', id),
    delete: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:delete', id),
    connect: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('connections:connect', id),
    move: (profileId: string, groupId: string | null): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('connections:move', profileId, groupId)
  },
  groups: {
    list: (): Promise<ApiResult<ConnectionGroup[]>> => ipcRenderer.invoke('groups:list'),
    create: (name: string): Promise<ApiResult<ConnectionGroup>> =>
      ipcRenderer.invoke('groups:create', name),
    rename: (id: string, name: string): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('groups:rename', id, name),
    delete: (id: string): Promise<ApiResult<null>> => ipcRenderer.invoke('groups:delete', id),
    reorder: (orderedIds: string[]): Promise<ApiResult<null>> =>
      ipcRenderer.invoke('groups:reorder', orderedIds)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
