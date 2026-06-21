import { describe, expect, it } from 'vitest'
import {
  buildDropAndCreate,
  buildInsert,
  dumpFooter,
  dumpHeader,
  escapeSqlValue,
  quoteIdent
} from './sqlDumpHelpers'

describe('quoteIdent', () => {
  it('バッククォートで囲む', () => {
    expect(quoteIdent('a')).toBe('`a`')
  })
  it('内部のバッククォートを2重化する', () => {
    expect(quoteIdent('we`ird')).toBe('`we``ird`')
  })
})

describe('escapeSqlValue', () => {
  it('null / undefined は NULL', () => {
    expect(escapeSqlValue(null)).toBe('NULL')
    expect(escapeSqlValue(undefined)).toBe('NULL')
  })
  it('数値はそのまま、非有限は NULL', () => {
    expect(escapeSqlValue(42)).toBe('42')
    expect(escapeSqlValue(-3.14)).toBe('-3.14')
    expect(escapeSqlValue(Infinity)).toBe('NULL')
    expect(escapeSqlValue(NaN)).toBe('NULL')
  })
  it('bigint は文字列化', () => {
    expect(escapeSqlValue(123n)).toBe('123')
  })
  it('真偽値は 1 / 0', () => {
    expect(escapeSqlValue(true)).toBe('1')
    expect(escapeSqlValue(false)).toBe('0')
  })
  it('Buffer は 0x 16進、空 Buffer は空文字リテラル', () => {
    expect(escapeSqlValue(Buffer.from([0, 255]))).toBe('0x00ff')
    expect(escapeSqlValue(Buffer.alloc(0))).toBe("''")
  })
  it('文字列はシングルクォート囲み', () => {
    expect(escapeSqlValue('hello')).toBe("'hello'")
  })
  it('日時文字列もシングルクォート囲み', () => {
    expect(escapeSqlValue('2025-09-26 16:17:05')).toBe("'2025-09-26 16:17:05'")
  })
  it('シングルクォートをエスケープ', () => {
    expect(escapeSqlValue("a'b")).toBe("'a\\'b'")
  })
  it('バックスラッシュをエスケープ', () => {
    expect(escapeSqlValue('a\\b')).toBe("'a\\\\b'")
  })
  it('改行・タブ・CR・NUL・Ctrl-Z をエスケープ', () => {
    expect(escapeSqlValue('a\nb')).toBe("'a\\nb'")
    expect(escapeSqlValue('a\tb')).toBe("'a\\tb'")
    expect(escapeSqlValue('a\rb')).toBe("'a\\rb'")
    expect(escapeSqlValue('a\0b')).toBe("'a\\0b'")
    expect(escapeSqlValue('a\x1ab')).toBe("'a\\Zb'")
    expect(escapeSqlValue('a\bb')).toBe("'a\\bb'")
  })
})

describe('buildInsert', () => {
  it('空 rows は空文字', () => {
    expect(buildInsert('t', ['a'], [])).toBe('')
  })
  it('単一行', () => {
    expect(buildInsert('t', ['a', 'b'], [{ a: 1, b: 'x' }])).toBe(
      "INSERT INTO `t` (`a`, `b`) VALUES (1, 'x');\n"
    )
  })
  it('複数行（カンマ結合・NULL 含む）', () => {
    expect(
      buildInsert(
        't',
        ['a', 'b'],
        [
          { a: 1, b: 'x' },
          { a: 2, b: null }
        ]
      )
    ).toBe("INSERT INTO `t` (`a`, `b`) VALUES (1, 'x'),(2, NULL);\n")
  })
})

describe('buildDropAndCreate', () => {
  it('DROP と CREATE をセミコロン付きで返す', () => {
    expect(buildDropAndCreate('t', 'CREATE TABLE `t` (`a` int)')).toBe(
      'DROP TABLE IF EXISTS `t`;\nCREATE TABLE `t` (`a` int);\n'
    )
  })
})

describe('dumpHeader / dumpFooter', () => {
  it('ヘッダに DB 名・生成日時・SET 文を含む', () => {
    const h = dumpHeader('mydb', '2026-06-08T00:00:00.000Z')
    expect(h).toContain('-- Database: mydb')
    expect(h).toContain('-- Generated: 2026-06-08T00:00:00.000Z')
    expect(h).toContain('SET NAMES utf8mb4;')
    expect(h).toContain('SET FOREIGN_KEY_CHECKS=0;')
  })
  it('フッタは FK チェックを戻す', () => {
    expect(dumpFooter()).toBe('\nSET FOREIGN_KEY_CHECKS=1;\n')
  })
})
