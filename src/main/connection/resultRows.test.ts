import { describe, expect, it } from 'vitest'
import { extractRows } from './resultRows'

describe('extractRows', () => {
  it('配列（SELECT）はそのまま dataRows、affectedRows は undefined', () => {
    const r = extractRows([{ id: 1 }, { id: 2 }])
    expect(r.dataRows).toEqual([{ id: 1 }, { id: 2 }])
    expect(r.affectedRows).toBeUndefined()
  })

  it('ResultSetHeader（非SELECT）は dataRows 空・affectedRows を取り出す', () => {
    const r = extractRows({ affectedRows: 3, insertId: 0, warningStatus: 0 })
    expect(r.dataRows).toEqual([])
    expect(r.affectedRows).toBe(3)
  })

  it('affectedRows が 0 でも数値として取り出す', () => {
    const r = extractRows({ affectedRows: 0 })
    expect(r.affectedRows).toBe(0)
  })
})
