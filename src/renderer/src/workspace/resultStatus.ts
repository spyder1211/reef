import type { QueryResult } from '../../../shared/types'

// 非SELECT（列が無く影響行数がある）結果か。true なら「N 行に影響」を表示する。
// SELECT は 0 行ヒットでも fields を持ち columns.length > 0 になるため、ここで弾かれる。
export function isAffectedResult(result: QueryResult): boolean {
  return result.columns.length === 0 && result.affectedRows != null
}
