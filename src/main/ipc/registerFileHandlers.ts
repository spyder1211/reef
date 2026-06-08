import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import type { ApiResult, SaveFileResult } from '../../shared/types'

export function registerFileHandlers(): void {
  ipcMain.handle(
    'file:saveCsv',
    async (_e, defaultFileName: string, content: string): Promise<ApiResult<SaveFileResult>> => {
      try {
        const opts = {
          defaultPath: defaultFileName,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        }
        const win = BrowserWindow.getFocusedWindow()
        const result = win
          ? await dialog.showSaveDialog(win, opts)
          : await dialog.showSaveDialog(opts)
        if (result.canceled || !result.filePath) {
          return { ok: true, data: { canceled: true } }
        }
        // BOM を付与して UTF-8 で書き込む（Excel で日本語が文字化けしないように）
        await writeFile(result.filePath, '﻿' + content, 'utf-8')
        return { ok: true, data: { canceled: false, filePath: result.filePath } }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: { code: 'FILE_ERROR', message } }
      }
    }
  )
}
