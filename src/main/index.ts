import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { ConnectionManager } from './connection/ConnectionManager'
import { QueryHistoryStore } from './history/QueryHistoryStore'
import type { TunnelHolder } from './connection/connectWithTunnel'
import { registerDbHandlers } from './ipc/registerDbHandlers'
import { registerConnectionHandlers } from './ipc/registerConnectionHandlers'
import { registerFileHandlers } from './ipc/registerFileHandlers'
import { registerImportHandlers } from './import/registerImportHandlers'
import { createConnectionStores } from './connection/createProfileStore'
import { buildAppMenu } from './menu'

// 本番ビルドのレンダラに付与する Content-Security-Policy。
// script-src 'self'（unsafe-inline/eval なし）が要。style は React/CodeMirror の
// インラインスタイル用に 'unsafe-inline' を許可（スタイル注入は script より低リスク）。
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; frame-src 'none'; base-uri 'none'"

// アプリの表示名。macOS のアプリメニューやダイアログのタイトルに使われる。
// dev/prod を問わず確実に反映させるため明示設定する（package.json の
// productName はビルド時のバンドル名用で、ランタイムの解決に依存しないようにする）。
app.setName('Table++')

// dev モードの Dock アイコン。パッケージ版は .icns がバンドルに焼き込まれるため不要だが、
// electron-vite dev では Electron 既定アイコンになるので、リポジトリの build/icon.png を使う。
if (process.env['ELECTRON_RENDERER_URL'] && process.platform === 'darwin') {
  const devIcon = join(__dirname, '../../build/icon.png')
  if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
}

// 明示的なアプリ終了（Cmd+Q / quit ロール）中かどうか。
// quit も window の close を経由するため、これを見て「閉じるボタン」と区別する。
let isQuitting = false
app.on('before-quit', () => {
  isQuitting = true
})

// レンダラからのアプリ外遷移・新規ウィンドウ生成を禁止する（防御的。現状アプリは遷移も window.open もしない）。
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const sameApp = (devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!sameApp) event.preventDefault() // アプリ外への遷移を禁止
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url) // 外部 URL は既定ブラウザで開く
    return { action: 'deny' } // アプリ内に新規ウィンドウは開かない
  })
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
      sandbox: true
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
  // dev（Vite HMR）では CSP を付けない。本番ビルド（loadFile）でのみ strict CSP を付与する。
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] }
      })
    })
  }
  const manager = new ConnectionManager()
  const history = new QueryHistoryStore(app.getPath('userData'))
  // SSH トンネルを connect/disconnect ハンドラ間で共有するためのホルダ。
  const tunnel: TunnelHolder = { current: null }
  registerDbHandlers(manager, history, tunnel)
  const { profileStore, groupStore } = createConnectionStores()
  registerConnectionHandlers(manager, profileStore, groupStore, tunnel)
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
