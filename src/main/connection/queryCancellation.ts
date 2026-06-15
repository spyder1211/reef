// 実行中クエリが KILL QUERY で中断された時に投げる番兵エラー。
// IPC 層がこれを検出して既存の CANCELLED（静かな中止）へ翻訳する。
export class QueryCancelledError extends Error {
  constructor() {
    super('Query cancelled')
    this.name = 'QueryCancelledError'
  }
}

// mysql2 の「クエリ実行が中断された」エラー（KILL QUERY 由来）か判定する。
// code='ER_QUERY_INTERRUPTED' / errno=1317 のどちらかで判定。
export function isQueryInterrupted(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: unknown; errno?: unknown }
  return e.code === 'ER_QUERY_INTERRUPTED' || e.errno === 1317
}
