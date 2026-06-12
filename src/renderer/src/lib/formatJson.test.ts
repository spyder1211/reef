import { describe, it, expect } from 'vitest'
import { tryFormatJson } from './formatJson'

describe('tryFormatJson', () => {
  it('JSON オブジェクトを 2 スペースで整形する', () => {
    expect(tryFormatJson('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })
  it('JSON 配列も整形する', () => {
    expect(tryFormatJson('[1,2]')).toBe('[\n  1,\n  2\n]')
  })
  it('プリミティブ（数値・文字列）は null（整形対象外）', () => {
    expect(tryFormatJson('123')).toBeNull()
    expect(tryFormatJson('"hello"')).toBeNull()
  })
  it('JSON でない文字列は null', () => {
    expect(tryFormatJson('hello world')).toBeNull()
    expect(tryFormatJson('')).toBeNull()
  })
})
