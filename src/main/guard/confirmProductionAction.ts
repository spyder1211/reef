import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'

export type ConfirmTier = 'write' | 'catastrophic'

// ダイアログの options を組み立てる純粋関数（表示はしない）。
export function buildConfirmOptions(
  tier: ConfirmTier,
  opLabel: string,
  connName: string
): MessageBoxOptions {
  const base: MessageBoxOptions = {
    type: 'warning',
    buttons: ['キャンセル', '実行する'],
    defaultId: 0,
    cancelId: 0,
    title: '本番環境での操作',
    message: `本番環境（${connName}）で「${opLabel}」を実行しようとしています。`,
    detail: '本番データに直接影響します。よろしいですか？'
  }
  if (tier === 'catastrophic') {
    return {
      ...base,
      detail: '本番データを破壊・置換する可能性があります。十分に確認してください。',
      checkboxLabel: '本番だと理解した上で実行する',
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
