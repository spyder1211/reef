import { describe, expect, it } from 'vitest'
import { firstEditableColumn } from './gridEditing'

describe('firstEditableColumn', () => {
  it('先頭列の名前を返す', () => {
    expect(firstEditableColumn([{ name: 'id' }, { name: 'name' }])).toBe('id')
  })
  it('列が無ければ null', () => {
    expect(firstEditableColumn([])).toBeNull()
  })
})
