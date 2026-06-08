import { Menu, dialog, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { createWriteStream } from 'fs'
import { once } from 'events'
import type { ConnectionManager } from './connection/ConnectionManager'
import { dumpDatabase } from './dump/SqlDumper'

// File →「SQLダンプをエクスポート…」の本体。接続確認 → 保存ダイアログ → ストリーム書き込み → 結果通知。
async function exportSqlDump(manager: ConnectionManager): Promise<void> {
  if (!manager.isConnected()) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'DB に接続していません',
      detail: '接続してから SQL ダンプを実行してください。'
    })
    return
  }

  // 既定ファイル名のため DB 名を取得（失敗時は dump で続行）。
  let dbName = 'dump'
  try {
    const res = await manager.query('SELECT DATABASE() AS db')
    const db = res.rows[0]?.db
    if (db) dbName = String(db)
  } catch {
    // ignore: 既定名で続行
  }

  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    defaultPath: `${dbName}.sql`,
    filters: [{ name: 'SQL', extensions: ['sql'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return

  const stream = createWriteStream(result.filePath, 'utf-8')
  try {
    const summary = await dumpDatabase(
      manager,
      (chunk) => stream.write(chunk),
      new Date().toISOString()
    )
    stream.end()
    await once(stream, 'finish')
    await dialog.showMessageBox({
      type: 'info',
      message: 'SQL ダンプを保存しました',
      detail: `${result.filePath}\n${summary.tableCount} テーブル / ${summary.rowCount} 行`
    })
  } catch (err) {
    stream.destroy()
    const message = err instanceof Error ? err.message : String(err)
    await dialog.showMessageBox({
      type: 'error',
      message: 'SQL ダンプに失敗しました',
      detail: `${message}\n部分的に書き込まれたファイルが残っている可能性があります。`
    })
  }
}

// App / File / Edit / View / Window のネイティブメニューを構築する。
export function buildAppMenu(manager: ConnectionManager): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'SQLダンプをエクスポート…',
          click: () => {
            void exportSqlDump(manager)
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
