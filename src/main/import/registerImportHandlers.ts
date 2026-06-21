import { ipcMain } from 'electron'
import type { ConnectionManager } from '../connection/ConnectionManager'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ApiResult, ImportSummary } from '../../shared/types'
import { importSqlDump } from './SqlImporter'
import { consumePendingImport, isImporting, setImporting } from './importState'
import { guardProductionTier } from '../guard/productionGuard'
import { t } from '../i18n'

// 進捗 push の throttle 間隔（ミリ秒）。大きな dump で IPC を溢れさせない。
const PROGRESS_THROTTLE_MS = 100

export function registerImportHandlers(manager: ConnectionManager): void {
  ipcMain.handle('sqlImport:start', async (e): Promise<ApiResult<ImportSummary>> => {
    // 本番では実行前に強い確認（pending を消費する前にガードする）。
    if (!(await guardProductionTier(e, 'catastrophic', t('dialog.opSqlImport')))) {
      return { ok: false, error: { code: 'CANCELLED', message: '' } }
    }
    const filePath = consumePendingImport()
    if (!filePath) {
      return {
        ok: false,
        error: { code: 'NO_PENDING_IMPORT', message: t('error.noPendingImport') }
      }
    }
    if (isImporting()) {
      return { ok: false, error: { code: 'IMPORT_BUSY', message: t('error.importBusy') } }
    }
    setImporting(true)
    let last = 0
    try {
      const summary = await importSqlDump(manager, filePath, (p) => {
        const now = Date.now()
        if (now - last >= PROGRESS_THROTTLE_MS) {
          last = now
          e.sender.send('app:sql-import-progress', p)
        }
      })
      return { ok: true, data: summary }
    } catch (err) {
      return { ok: false, error: normalizeDbError(err) }
    } finally {
      setImporting(false)
    }
  })
}
