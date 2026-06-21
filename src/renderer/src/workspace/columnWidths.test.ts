import { describe, expect, it } from 'vitest'
import { estimateColumnWidths, MAX_COL_WIDTH, MIN_COL_WIDTH, ROW_HEIGHT } from './columnWidths'

// 1文字 = 10px の決定論的フェイク計測器
const measure = (text: string): number => text.length * 10

describe('estimateColumnWidths', () => {
  it('列が無ければ空配列を返す', () => {
    expect(estimateColumnWidths([], [], measure)).toEqual([])
  })

  it('行が無ければヘッダ幅から算出する（パディング加算＋下限クランプ）', () => {
    // measure('id') = 20, +padding(24) = 44, 下限48でクランプ
    expect(estimateColumnWidths([{ name: 'id' }], [], measure)).toEqual([MIN_COL_WIDTH])
    // measure('description') = 110, +24 = 134
    expect(estimateColumnWidths([{ name: 'description' }], [], measure)).toEqual([134])
  })

  it('サンプル行の最大セル幅を採用する（ヘッダより長いセル）', () => {
    const cols = [{ name: 'name' }] // measure('name') = 40
    const rows = [{ name: 'short' }, { name: 'a-very-long-value' }] // 50, 170
    // 最大170 +24 = 194
    expect(estimateColumnWidths(cols, rows, measure)).toEqual([194])
  })

  it('sampleRows を超える行は無視する', () => {
    const cols = [{ name: 'c' }] // 10
    const rows = [{ c: 'x' }, { c: 'WAY-TOO-LONG-IGNORED' }] // index0=10, index1=200
    // sampleRows=1 なら index0 のみ: max(10, header10)=10, +24=34, 下限48
    expect(estimateColumnWidths(cols, rows, measure, { sampleRows: 1 })).toEqual([MIN_COL_WIDTH])
  })

  it('上限でクランプする', () => {
    const cols = [{ name: 'big' }]
    const rows = [{ big: 'x'.repeat(100) }] // 1000px
    expect(estimateColumnWidths(cols, rows, measure)).toEqual([MAX_COL_WIDTH])
  })

  it('null/undefined は "NULL"(4文字) として計測する', () => {
    const cols = [{ name: 'v' }] // header 'v' = 10
    const rows = [{ v: null }, { v: undefined }] // 'NULL' = 40 each
    // 最大40 +24 = 64
    expect(estimateColumnWidths(cols, rows, measure)).toEqual([64])
  })

  it('ROW_HEIGHT は仮想化用に 25 で固定', () => {
    expect(ROW_HEIGHT).toBe(25)
  })
})
