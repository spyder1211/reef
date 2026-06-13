import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getProductionContext, isProductionConnection } from '../connection/productionContext'
import { classifyScript } from './classifyStatement'
import { confirmProductionAction, type ConfirmTier } from './confirmProductionAction'

// 共通: production なら確認、非 production なら即 true（素通り）。
async function guard(
  win: BrowserWindow | null,
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  if (!isProductionConnection()) return true
  const name = getProductionContext()?.name ?? '本番環境'
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
  if (!isProductionConnection()) return true
  const tier = classifyScript(sql)
  if (tier === 'readonly') return true
  return guard(BrowserWindow.fromWebContents(e.sender), tier, opLabel)
}

// メニュー用: フォーカス中ウィンドウを親に確認。
export async function guardProductionMenu(
  tier: ConfirmTier,
  opLabel: string
): Promise<boolean> {
  return guard(BrowserWindow.getFocusedWindow(), tier, opLabel)
}
