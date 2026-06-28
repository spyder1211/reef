import { describe, expect, it } from 'vitest'
import { isAffectedResult } from './resultStatus'

const base = { rows: [], rowCount: 0, durationMs: 1 }

describe('isAffectedResult', () => {
  it('列なし＋affectedRows あり → true（非SELECT）', () => {
    expect(isAffectedResult({ ...base, columns: [], affectedRows: 3 })).toBe(true)
  })
  it('affectedRows が 0 でも true', () => {
    expect(isAffectedResult({ ...base, columns: [], affectedRows: 0 })).toBe(true)
  })
  it('列あり（SELECT）→ false', () => {
    expect(isAffectedResult({ ...base, columns: [{ name: 'id' }], affectedRows: undefined })).toBe(
      false
    )
  })
  it('列なし＋affectedRows なし（0行SELECT想定）→ false', () => {
    expect(isAffectedResult({ ...base, columns: [] })).toBe(false)
  })
})
