import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { t } from '../i18n'

export type ConfirmTier = 'write' | 'catastrophic'

// ダイアログの options を組み立てる純粋関数（表示はしない）。
export function buildConfirmOptions(
  tier: ConfirmTier,
  opLabel: string,
  connName: string
): MessageBoxOptions {
  const base: MessageBoxOptions = {
    type: 'warning',
    buttons: [t('common.cancel'), t('dialog.production.confirm')],
    defaultId: 0,
    cancelId: 0,
    title: t('dialog.production.title'),
    message: t('dialog.production.message', { conn: connName, op: opLabel }),
    detail: t('dialog.production.detail')
  }
  if (tier === 'catastrophic') {
    return {
      ...base,
      detail: t('dialog.production.detailCatastrophic'),
      checkboxLabel: t('dialog.production.checkboxLabel'),
      checkboxChecked: false
    }
  }
  return base
}

// 実際に確認ダイアログを表示し、続行可否を返す。showMessageBox は注入可能（テスト用）。
export async function confirmProductionAction(
  win: BrowserWindow | null,
  tier: ConfirmTier,
  opLabel: string,
  connName: string,
  deps: { showMessageBox?: typeof dialog.showMessageBox } = {}
): Promise<boolean> {
  const show = deps.showMessageBox ?? dialog.showMessageBox
  const options = buildConfirmOptions(tier, opLabel, connName)
  const result = win ? await show(win, options) : await show(options)
  if (result.response !== 1) return false // 「実行する」以外は中止
  if (tier === 'catastrophic' && !result.checkboxChecked) return false // チェック必須
  return true
}
