import { ipcMain, BrowserWindow, safeStorage } from 'electron'
import { ConnectionManager } from '../connection/ConnectionManager'
import { ProfileStore } from '../connection/ProfileStore'
import { GroupStore } from '../connection/GroupStore'
import { validateConnectionConfig } from '../connection/validateConnectionConfig'
import { normalizeDbError } from '../connection/normalizeDbError'
import { connectWithTunnel, type TunnelHolder } from '../connection/connectWithTunnel'
import { setProductionContext, clearProductionContext } from '../connection/productionContext'
import { t } from '../i18n'
import type { ApiResult, ConnectionGroup, ConnectionProfile, ConnectionProfileInput } from '../../shared/types'

export function registerConnectionHandlers(
  manager: ConnectionManager,
  store: ProfileStore,
  groups: GroupStore,
  tunnel: TunnelHolder
): void {
  ipcMain.handle('connections:list', async (): Promise<ApiResult<ConnectionProfile[]>> => {
    try {
      return { ok: true, data: store.list() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle(
    'connections:save',
    async (_e, input: ConnectionProfileInput): Promise<ApiResult<ConnectionProfile>> => {
      if (!input.name) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: t('error.nameRequired') } }
      }
      const errors = validateConnectionConfig(input)
      if (errors.length > 0) {
        return { ok: false, error: { code: 'INVALID_CONFIG', message: errors.join(', ') } }
      }
      try {
        return { ok: true, data: store.save(input) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle(
    'connections:duplicate',
    async (_e, id: string): Promise<ApiResult<ConnectionProfile>> => {
      try {
        return { ok: true, data: store.duplicate(id) }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('connections:delete', async (_e, id: string): Promise<ApiResult<null>> => {
    try {
      store.delete(id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('connections:connect', async (e, id: string): Promise<ApiResult<null>> => {
    // 接続を切り替えるため、まず本番判定をリセットし、成功時に新プロファイルで再設定する。
    clearProductionContext()
    try {
      const config = store.getConnectConfig(id)
      await connectWithTunnel(manager, config, tunnel)
      // tag を含む ConnectionProfile は list() からしか取れない。
      const meta = store.list().find((p) => p.id === id)
      if (meta) setProductionContext({ tag: meta.tag, name: meta.name })
      // 接続成功でテーブル一覧画面へ遷移する。作業領域いっぱいにウィンドウを最大化する。
      BrowserWindow.fromWebContents(e.sender)?.maximize()
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle(
    'connections:move',
    async (_e, profileId: string, groupId: string | null): Promise<ApiResult<null>> => {
      try {
        store.move(profileId, groupId)
        return { ok: true, data: null }
      } catch (err) {
        return { ok: false, error: normalizeDbError(err) }
      }
    }
  )

  ipcMain.handle('connections:isEncryptionAvailable', async (): Promise<ApiResult<boolean>> => {
    return { ok: true, data: safeStorage.isEncryptionAvailable() }
  })

  ipcMain.handle('groups:list', async (): Promise<ApiResult<ConnectionGroup[]>> => {
    try {
      return { ok: true, data: groups.list() }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:create', async (_e, name: string): Promise<ApiResult<ConnectionGroup>> => {
    if (!name || !name.trim()) {
      return { ok: false, error: { code: 'INVALID_CONFIG', message: t('error.groupNameRequired') } }
    }
    try {
      return { ok: true, data: groups.create(name) }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:rename', async (_e, id: string, name: string): Promise<ApiResult<null>> => {
    if (!name || !name.trim()) {
      return { ok: false, error: { code: 'INVALID_CONFIG', message: t('error.groupNameRequired') } }
    }
    try {
      groups.rename(id, name)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:delete', async (_e, id: string): Promise<ApiResult<null>> => {
    try {
      groups.delete(id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })

  ipcMain.handle('groups:reorder', async (_e, orderedIds: string[]): Promise<ApiResult<null>> => {
    try {
      groups.reorder(orderedIds)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    }
  })
}
