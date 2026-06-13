import type { ConnectionTag } from '../../shared/types'

// 現在の接続が production かどうかを main プロセス全体で共有するモジュールシングルトン。
// src/main/import/importState.ts と同じ「プロセス内に1つだけ存在するクロスカット状態」方式。
interface ProductionContextValue {
  tag: ConnectionTag
  name: string
}

let current: ProductionContextValue | null = null

export function setProductionContext(value: ProductionContextValue): void {
  current = value
}

export function clearProductionContext(): void {
  current = null
}

export function getProductionContext(): ProductionContextValue | null {
  return current
}

// renderer の isProductionProfile と同じ基準（tag === 'production'）。
export function isProductionConnection(): boolean {
  return current?.tag === 'production'
}
