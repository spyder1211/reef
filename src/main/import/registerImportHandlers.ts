import { ipcMain } from 'electron'
import type { ConnectionManager } from '../connection/ConnectionManager'
import { normalizeDbError } from '../connection/normalizeDbError'
import type { ApiResult, ImportSummary } from '../../shared/types'
import { importSqlDump } from './SqlImporter'
import { consumePendingImport, isImporting, setImporting } from './importState'

// 進捗 push の throttle 間隔（ミリ秒）。大きな dump で IPC を溢れさせない。
const PROGRESS_THROTTLE_MS = 100

export function registerImportHandlers(manager: ConnectionManager): void {
  ipcMain.handle('sqlImport:start', async (e): Promise<ApiResult<ImportSummary>> => {
    const filePath = consumePendingImport()
    if (!filePath) {
      return {
        ok: false,
        error: { code: 'NO_PENDING_IMPORT', message: 'インポート対象のファイルが選択されていません' }
      }
    }
    if (isImporting()) {
      return { ok: false, error: { code: 'IMPORT_BUSY', message: '別のインポートが実行中です' } }
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
