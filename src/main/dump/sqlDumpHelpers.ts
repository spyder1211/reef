// SQL ダンプの直列化ヘルパー（純粋関数・副作用なし）。
// 値は JS ランタイム型で判定する（ConnectionManager は dateStrings:true のため日時は文字列で届く）。
import { quoteIdent } from '../../shared/sqlIdent'

// quoteIdent は共有モジュールに一本化。sqlDumpHelpers.test.ts 等の既存 import 互換のため再エクスポート。
export { quoteIdent }

// MySQL 文字列リテラルのエスケープ（シングルクォート囲み）。各マッチを独立に置換するため2重化は起きない。
function escapeString(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional SQL escape character matching
  const escaped = s.replace(/[\0\b\t\n\r\x1a\\']/g, (ch) => {
    switch (ch) {
      case '\0':
        return '\\0'
      case '\b':
        return '\\b'
      case '\t':
        return '\\t'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\x1a':
        return '\\Z'
      case '\\':
        return '\\\\'
      case "'":
        return "\\'"
      default:
        return ch
    }
  })
  return `'${escaped}'`
}

// 1 つの値を SQL リテラルに変換する。
export function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Buffer.isBuffer(value)) return value.length === 0 ? "''" : `0x${value.toString('hex')}`
  return escapeString(String(value))
}

// 複数行をまとめた INSERT 文（末尾改行付き）。rows が空なら空文字。列順は columns に従う。
export function buildInsert(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return ''
  const cols = columns.map(quoteIdent).join(', ')
  const tuples = rows
    .map((row) => `(${columns.map((c) => escapeSqlValue(row[c])).join(', ')})`)
    .join(',')
  return `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES ${tuples};\n`
}

// DROP TABLE IF EXISTS と CREATE TABLE（SHOW CREATE TABLE の結果）をセミコロン付きで返す。
// createTableSql は SHOW CREATE TABLE の結果（mysql2 は末尾セミコロンを含まない）を想定し、末尾に ; を含めない前提。
export function buildDropAndCreate(table: string, createTableSql: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(table)};\n${createTableSql};\n`
}

// ダンプ先頭のコメント＋セッション設定。
export function dumpHeader(dbName: string, generatedAt: string): string {
  return (
    `-- Reef SQL Dump\n` +
    `-- Database: ${dbName}\n` +
    `-- Generated: ${generatedAt}\n\n` +
    `SET NAMES utf8mb4;\n` +
    `SET FOREIGN_KEY_CHECKS=0;\n\n`
  )
}

// ダンプ末尾。FK チェックを元に戻す。
export function dumpFooter(): string {
  return `\nSET FOREIGN_KEY_CHECKS=1;\n`
}
