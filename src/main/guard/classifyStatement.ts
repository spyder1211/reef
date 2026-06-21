import { SqlStatementSplitter } from '../import/sqlStatementSplitter'

export type GuardTier = 'readonly' | 'write' | 'catastrophic'

// 先頭キーワードが DROP/TRUNCATE → catastrophic、書き込み系 → write、それ以外 → readonly。
const CATASTROPHIC = new Set(['DROP', 'TRUNCATE'])
const WRITE = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'ALTER',
  'CREATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'CALL',
  'LOAD',
  'WITH' // CTE: WITH ... DML（先頭は WITH）。本番ガードを迂回させないため write 扱い
])

// 1文の先頭キーワードを大文字で取り出す。先頭の空白・開き括弧・コメントは除去。
// SqlStatementSplitter はコメントを残したまま文を返すため、`-- drop\nDROP TABLE t` の
// ようなコメント始まりの破壊的文で本番ガードを迂回させないよう、実キーワードまで剥がす。
function leadingKeyword(sql: string): string {
  let s = sql.trim()
  for (;;) {
    const before = s
    s = s.replace(/^\(+\s*/, '') // 開き括弧
    s = s.replace(/^(?:--|#)[^\n]*\n?\s*/, '') // 行コメント（-- / #）
    s = s.replace(/^\/\*[\s\S]*?\*\/\s*/, '') // ブロックコメント /* ... */
    if (s === before) break // これ以上剥がせなくなったら確定
  }
  const m = s.match(/^[A-Za-z_]+/)
  return m ? m[0].toUpperCase() : ''
}

export function classifyStatement(sql: string): GuardTier {
  const kw = leadingKeyword(sql)
  if (CATASTROPHIC.has(kw)) return 'catastrophic'
  if (WRITE.has(kw)) return 'write'
  return 'readonly'
}

const RANK: Record<GuardTier, number> = { readonly: 0, write: 1, catastrophic: 2 }

// スクリプト全体を文単位に分割し、最大ティアを返す。空/コメントのみは readonly。
export function classifyScript(sql: string): GuardTier {
  const splitter = new SqlStatementSplitter()
  const statements = [...splitter.push(sql), ...splitter.end()]
  let tier: GuardTier = 'readonly'
  for (const stmt of statements) {
    const t = classifyStatement(stmt)
    if (RANK[t] > RANK[tier]) tier = t
  }
  return tier
}
