import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import { CSP } from '../shared/csp'
import { resolveLocale, systemLocaleFromElectron } from '../shared/i18n/resolveLocale'
import { ConnectionManager } from './connection/ConnectionManager'
import type { TunnelHolder } from './connection/connectWithTunnel'
import { createConnectionStores } from './connection/createProfileStore'
import { QueryHistoryStore } from './history/QueryHistoryStore'
import { setLocale } from './i18n'
import { registerImportHandlers } from './import/registerImportHandlers'
import { registerConnectionHandlers } from './ipc/registerConnectionHandlers'
import { registerDbHandlers } from './ipc/registerDbHandlers'
import { registerFileHandlers } from './ipc/registerFileHandlers'
import { registerI18nHandlers } from './ipc/registerI18nHandlers'
import { buildAppMenu } from './menu'
import { createSettingsStore } from './settings/createSettingsStore'

// アプリの表示名。macOS のアプリメニューやダイアログのタイトルに使われる。
// dev/prod を問わず確実に反映させるため明示設定する（package.json の
// productName はビルド時のバンドル名用で、ランタイムの解決に依存しないようにする）。
app.setName('Reef')

// dev モードの Dock アイコン。パッケージ版は .icns がバンドルに焼き込まれるため不要だが、
// electron-vite dev では Electron 既定アイコンになるので、リポジトリの build/icon.png を使う。
if (process.env.ELECTRON_RENDERER_URL && process.platform === 'darwin') {
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
    const devUrl = process.env.ELECTRON_RENDERER_URL
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

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // dev（Vite HMR）では CSP を付けない。本番ビルド（loadFile）でのみ strict CSP を付与する。
  const isDev = !!process.env.ELECTRON_RENDERER_URL
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
  // Cmd+W で閉じるタブが無い場合のフォールバック。renderer から呼ばれる。
  // close() は既存の win.on('close') 介入（接続中→接続一覧へ / 未接続→終了）を通る。
  ipcMain.on('app:close-window', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  // 言語設定を解決してから menu を構築する（menu ラベルが t() を使うため）。
  const settings = createSettingsStore()
  const system = systemLocaleFromElectron(app.getLocale())
  setLocale(resolveLocale(settings.getLocalePreference(), system))

  const rebuildMenu = (): void => Menu.setApplicationMenu(buildAppMenu(manager))
  registerI18nHandlers(settings, rebuildMenu)
  rebuildMenu()
  createWindow(manager)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(manager)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
