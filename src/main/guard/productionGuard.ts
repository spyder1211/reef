import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getProductionContext, isProductionConnection } from '../connection/productionContext'
import { t } from '../i18n'
import { classifyScript } from './classifyStatement'
import { type ConfirmTier, confirmProductionAction } from './confirmProductionAction'

// 共通: production なら確認、非 production なら即 true（素通り）。
async function guard(
  win: BrowserWindow | null,
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  if (!isProductionConnection()) return true
  const name = getProductionContext()?.name ?? t('dialog.production.unknownConn')
  return confirmProductionAction(win, tier, opLabel, name)
}

// IPC ハンドラ用: 固定ティアで確認。
export async function guardProductionTier(
  e: IpcMainInvokeEvent,
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  return guard(BrowserWindow.fromWebContents(e.sender), tier, opLabel)
}

// IPC ハンドラ用: SQL 文字列を分類してから確認（readonly は即 true）。
export async function guardProductionSql(
  e: IpcMainInvokeEvent,
  sql: string,
  opLabel: string
): Promise<boolean> {
  // 非 production 時は classifyScript を呼ばないための早期判定（guard() 内の再判定は意図的）。
  if (!isProductionConnection()) return true
  const tier = classifyScript(sql)
  if (tier === 'readonly') return true
  return guard(BrowserWindow.fromWebContents(e.sender), tier, opLabel)
}

// メニュー用: フォーカス中ウィンドウを親に確認。
export async function guardProductionMenu(tier: ConfirmTier, opLabel: string): Promise<boolean> {
  return guard(BrowserWindow.getFocusedWindow(), tier, opLabel)
}
