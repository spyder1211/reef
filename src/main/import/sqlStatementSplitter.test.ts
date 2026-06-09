import { describe, it, expect } from 'vitest'
import { SqlStatementSplitter } from './sqlStatementSplitter'

// 1 回 push して end() した結果をまとめて取得するヘルパー
function splitAll(input: string): string[] {
  const s = new SqlStatementSplitter()
  return [...s.push(input), ...s.end()]
}

describe('SqlStatementSplitter', () => {
  it('単純な複数文を ; で分割し、末尾 ; を除いて返す', () => {
    expect(splitAll('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('末尾にセミコロンが無い最終文も返す', () => {
    expect(splitAll('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('空文（;;）や空白のみは捨てる', () => {
    expect(splitAll('SELECT 1;;  ;\n')).toEqual(['SELECT 1'])
  })

  it('シングルクォート文字列内の ; は区切らない', () => {
    expect(splitAll("INSERT INTO t VALUES ('a;b');")).toEqual(["INSERT INTO t VALUES ('a;b')"])
  })

  it("シングルクォートの \\' エスケープを跨ぐ", () => {
    expect(splitAll("INSERT INTO t VALUES ('a\\'; b');")).toEqual([
      "INSERT INTO t VALUES ('a\\'; b')"
    ])
  })

  it("'' 連続クォートはリテラル内として扱う", () => {
    expect(splitAll("INSERT INTO t VALUES ('it''s; ok');")).toEqual([
      "INSERT INTO t VALUES ('it''s; ok')"
    ])
  })

  it('ダブルクォート文字列内の ; は区切らない', () => {
    expect(splitAll('INSERT INTO t VALUES ("x;y");')).toEqual(['INSERT INTO t VALUES ("x;y")'])
  })

  it('バッククォート識別子内の ; は区切らない', () => {
    expect(splitAll('SELECT `a;b` FROM t;')).toEqual(['SELECT `a;b` FROM t'])
  })

  it('行コメント -- は除去し、後続の文は分割する', () => {
    expect(splitAll('-- hello; world\nSELECT 1;')).toEqual(['SELECT 1'])
  })

  it('# 行コメントも除去する', () => {
    expect(splitAll('# comment;\nSELECT 1;')).toEqual(['SELECT 1'])
  })

  it('-- の直後が空白でない場合はコメントにしない', () => {
    // 4-2 のような式の -- は演算子。コメント化しないこと（中身は実行側に委ねる）
    expect(splitAll('SELECT 4--2;')).toEqual(['SELECT 4--2'])
  })

  it('ブロックコメント /* */ を除去する', () => {
    expect(splitAll('/* c; c */ SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('CRLF を跨いで分割できる', () => {
    expect(splitAll('SELECT 1;\r\nSELECT 2;\r\n')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('先頭 BOM を除去する', () => {
    expect(splitAll('﻿SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('チャンク境界が文字列途中に来ても正しく連結する', () => {
    const s = new SqlStatementSplitter()
    const out = [...s.push("INSERT INTO t VALUES ('a;"), ...s.push("b');"), ...s.end()]
    expect(out).toEqual(["INSERT INTO t VALUES ('a;b')"])
  })

  it('チャンク境界が ; の直後に来ても重複や欠落がない', () => {
    const s = new SqlStatementSplitter()
    const out = [...s.push('SELECT 1;'), ...s.push('SELECT 2;'), ...s.end()]
    expect(out).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('複数行 INSERT をまとめて1文として返す', () => {
    const sql = 'INSERT INTO `t` (`a`,`b`)\nVALUES (1,2),\n(3,4);\n'
    expect(splitAll(sql)).toEqual(['INSERT INTO `t` (`a`,`b`)\nVALUES (1,2),\n(3,4)'])
  })
})
