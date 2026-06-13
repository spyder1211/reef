import { Menu, dialog, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { basename } from 'path'
import { once } from 'events'
import type { ConnectionManager } from './connection/ConnectionManager'
import { dumpDatabase } from './dump/SqlDumper'
import { setPendingImport } from './import/importState'
import { guardProductionMenu } from './guard/productionGuard'

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
  // 本番ではエクスポート（全行のファイル化）前に強い確認。
  if (!(await guardProductionMenu('catastrophic', 'SQL ダンプのエクスポート'))) return

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
  // createWriteStream はパスを開けなくても同期 throw せず非同期に 'error' を出す。
  // リスナ未設定だと uncaughtException でメインプロセスが落ちるため、常設リスナで捕捉する。
  let streamError: Error | null = null
  stream.on('error', (e) => {
    streamError = e
  })
  try {
    await once(stream, 'open') // 開けない場合は 'error' により reject される
    const summary = await dumpDatabase(
      manager,
      (chunk) => stream.write(chunk),
      new Date().toISOString()
    )
    if (streamError) throw streamError
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

// File →「SQLダンプをインポート / リストア…」の本体。
// 接続確認 → ファイル選択 → 選択パスを main 側に保持 → renderer に開始要求を送る。
// 実際の実行は renderer の確認モーダル経由で sqlImport:start が呼ばれて行われる。
async function importSqlDump(manager: ConnectionManager): Promise<void> {
  if (!manager.isConnected()) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'DB に接続していません',
      detail: '接続してから SQL ダンプを import してください。'
    })
    return
  }

  // 確認表示用に接続中の DB 名を取得（失敗時は空文字）。
  let dbName = ''
  try {
    const res = await manager.query('SELECT DATABASE() AS db')
    const db = res.rows[0]?.db
    if (db) dbName = String(db)
  } catch {
    // ignore: 空のまま続行
  }

  const win = BrowserWindow.getFocusedWindow()
  const opts = {
    properties: ['openFile' as const],
    filters: [{ name: 'SQL dump', extensions: ['sql', 'gz'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return

  const filePath = result.filePaths[0]
  const { size } = await stat(filePath)
  setPendingImport(filePath)
  win?.webContents.send('app:sql-import-request', {
    fileName: basename(filePath),
    totalBytes: size,
    dbName
  })
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
            // 捕捉漏れ（ダイアログ拒否など）でメインプロセスが落ちないよう最終防衛で握る。
            exportSqlDump(manager).catch((err) => {
              console.error('exportSqlDump failed:', err)
            })
          }
        },
        {
          label: 'SQLダンプをインポート / リストア…',
          click: () => {
            importSqlDump(manager).catch((err) => {
              console.error('importSqlDump failed:', err)
            })
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          // Cmd+R は Electron 標準のフルリロード（webContents.reload）ではなく、
          // 現在アクティブなタブのクエリ/テーブルを再実行する「再読み込み」に割り当てる。
          // フルリロードはレンダラの接続状態（zustand）を初期化してしまい、作業画面が
          // 接続一覧に戻る＝ウィンドウが閉じたように見える挙動になるため、外している。
          label: '再読み込み',
          accelerator: 'CmdOrCtrl+R',
          click: (_item, win) => {
            if (win instanceof BrowserWindow) {
              win.webContents.send('app:reload-active-tab')
            }
          }
        },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
