import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { ConnectionManager } from './connection/ConnectionManager'
import { registerDbHandlers } from './ipc/registerDbHandlers'
import { registerConnectionHandlers } from './ipc/registerConnectionHandlers'
import { registerFileHandlers } from './ipc/registerFileHandlers'
import { registerImportHandlers } from './import/registerImportHandlers'
import { createConnectionStores } from './connection/createProfileStore'
import { buildAppMenu } from './menu'

// 明示的なアプリ終了（Cmd+Q / quit ロール）中かどうか。
// quit も window の close を経由するため、これを見て「閉じるボタン」と区別する。
let isQuitting = false
app.on('before-quit', () => {
  isQuitting = true
})

function createWindow(manager: ConnectionManager): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 接続中（テーブル一覧表示中）に閉じるボタンを押したら、ウィンドウを閉じる代わりに
  // 接続一覧へ戻す。未接続（接続一覧画面）ではそのまま閉じる＝「閉じる2回」で終了する。
  // Cmd+Q などの明示的な終了（isQuitting）は妨げず通常どおり閉じる。
  win.on('close', (e) => {
    if (!isQuitting && manager.isConnected()) {
      e.preventDefault()
      win.webContents.send('app:return-to-connections')
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const manager = new ConnectionManager()
  registerDbHandlers(manager)
  const { profileStore, groupStore } = createConnectionStores()
  registerConnectionHandlers(manager, profileStore, groupStore)
  registerFileHandlers()
  registerImportHandlers(manager)
  Menu.setApplicationMenu(buildAppMenu(manager))
  createWindow(manager)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(manager)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
