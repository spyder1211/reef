import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import type { ApiResult, SaveFileResult } from '../../shared/types'

export function registerFileHandlers(): void {
  ipcMain.handle(
    'file:saveCsv',
    async (e, defaultFileName: string, content: string): Promise<ApiResult<SaveFileResult>> => {
      try {
        const opts = {
          defaultPath: defaultFileName,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        }
        const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
        const result = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts)
        if (result.canceled || !result.filePath) {
          return { ok: true, data: { canceled: true } }
        }
        // BOM を付与して UTF-8 で書き込む（Excel で日本語が文字化けしないように）
        await writeFile(result.filePath, '\uFEFF' + content, 'utf-8')
        return { ok: true, data: { canceled: false, filePath: result.filePath } }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: { code: 'FILE_ERROR', message } }
      }
    }
  )

  // SSH \u79D8\u5BC6\u9375\u30D5\u30A1\u30A4\u30EB\u3092\u9078\u629E\u3057\u3001\u305D\u306E\u30D1\u30B9\u3092\u8FD4\u3059\uFF08\u63A5\u7D9A\u30D5\u30A9\u30FC\u30E0\u306E\u9375\u8A8D\u8A3C\u7528\uFF09\u3002
  ipcMain.handle('file:pickPrivateKey', async (e): Promise<ApiResult<SaveFileResult>> => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'SSH \u79D8\u5BC6\u9375\u3092\u9078\u629E' })
        : await dialog.showOpenDialog({ properties: ['openFile'], title: 'SSH \u79D8\u5BC6\u9375\u3092\u9078\u629E' })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: true, data: { canceled: true } }
      }
      return { ok: true, data: { canceled: false, filePath: result.filePaths[0] } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'FILE_ERROR', message } }
    }
  })
}
