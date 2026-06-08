import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('ヘッダ + 複数行を CRLF で連結する', () => {
    const csv = toCsv(
      ['id', 'name'],
      [
        { id: 1, name: 'x' },
        { id: 2, name: 'y' }
      ]
    )
    expect(csv).toBe('id,name\r\n1,x\r\n2,y')
  })

  it('null / undefined は空文字（空セル）', () => {
    expect(toCsv(['a', 'b'], [{ a: null, b: undefined }])).toBe('a,b\r\n,')
  })

  it('カンマを含む値はダブルクォートで囲む', () => {
    expect(toCsv(['a'], [{ a: 'x,y' }])).toBe('a\r\n"x,y"')
  })

  it('ダブルクォートを含む値は "" に2重化して囲む', () => {
    expect(toCsv(['a'], [{ a: 'he said "hi"' }])).toBe('a\r\n"he said ""hi"""')
  })

  it('改行を含む値はダブルクォートで囲む', () => {
    expect(toCsv(['a'], [{ a: 'line1\nline2' }])).toBe('a\r\n"line1\nline2"')
  })

  it('数値・真偽値は String() で文字列化', () => {
    expect(toCsv(['n', 'b'], [{ n: 42, b: true }])).toBe('n,b\r\n42,true')
  })

  it('行が空のときはヘッダ行のみ', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b')
  })

  it('列が空のときは空文字を返す', () => {
    expect(toCsv([], [])).toBe('')
  })

  it('BOM を含まない', () => {
    expect(toCsv(['a'], [{ a: '1' }]).charCodeAt(0)).not.toBe(0xfeff)
  })
})
