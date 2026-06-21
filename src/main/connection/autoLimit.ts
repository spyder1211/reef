import { DEFAULT_SQL_LIMIT } from '../../shared/queryLimits'

// 主verb候補（先頭または WITH 後に最初に現れる文の種別）。SELECT のときだけ自動LIMIT対象。
const STATEMENT_VERBS = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'CALL',
  'LOAD',
  'SET',
  'SHOW',
  'DESCRIBE',
  'DESC',
  'EXPLAIN',
  'USE',
  'ANALYZE',
  'OPTIMIZE'
])

// 括弧深度0（トップレベル）の英単語トークンを大文字で集める。
// 文字列リテラル（'...' "..."）・バッククォート識別子・括弧内（深度>0）は無視する。
// SqlStatementSplitter 通過後の文はコメント除去済みだが、念のためここではコメント除去はしない。
function topLevelWords(sql: string): string[] {
  const words: string[] = []
  let depth = 0
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (quote !== '`' && sql[i] === '\\') {
          i += 2
          continue
        } // バックスラッシュエスケープ
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          } // 二重引用符エスケープ（'' ""）
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '(') {
      depth++
      i++
      continue
    }
    if (ch === ')') {
      if (depth > 0) depth--
      i++
      continue
    }
    if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++
      words.push(sql.slice(i, j).toUpperCase())
      i = j
      continue
    }
    i++
  }
  return words
}

// 単一の素SELECT（先頭SELECT または WITH…SELECT、トップレベルLIMIT無し）のときだけ
// 末尾に LIMIT 500 を付与する。条件を満たさない・判定不能なら原文をそのまま返す。
export function maybeApplyAutoLimit(
  sql: string,
  statementCount: number
): { sql: string; applied: boolean } {
  try {
    if (statementCount !== 1) return { sql, applied: false }
    const words = topLevelWords(sql)
    const mainVerb = words.find((w) => STATEMENT_VERBS.has(w)) // WITH/RECURSIVE/CTE名/AS は跨ぐ
    if (mainVerb !== 'SELECT') return { sql, applied: false }
    if (words.includes('LIMIT')) return { sql, applied: false } // トップレベルLIMITあり
    return { sql: sql.replace(/\s+$/, '') + ` LIMIT ${DEFAULT_SQL_LIMIT}`, applied: true }
  } catch {
    return { sql, applied: false }
  }
}
