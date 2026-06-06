import { describe, it, expect } from 'vitest'
import { extractTableNames } from './extractTableNames'

describe('extractTableNames', () => {
  it('SHOW TABLES の行（先頭カラム値）を名前配列にする', () => {
    const rows = [{ Tables_in_app: 'users' }, { Tables_in_app: 'orders' }]
    expect(extractTableNames(rows)).toEqual(['users', 'orders'])
  })

  it('空配列なら空', () => {
    expect(extractTableNames([])).toEqual([])
  })

  it('空文字の名前は除外する', () => {
    expect(extractTableNames([{ Tables_in_app: '' }, { Tables_in_app: 'ok' }])).toEqual(['ok'])
  })
})
