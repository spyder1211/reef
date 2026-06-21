import { describe, it, expect } from 'vitest'
import { validateConnectionConfig } from './validateConnectionConfig'

describe('validateConnectionConfig', () => {
  it('正しい設定ではエラー0件', () => {
    expect(
      validateConnectionConfig({ host: 'localhost', port: 3306, user: 'root', password: '' })
    ).toEqual([])
  })

  it('host 欠落を検出', () => {
    expect(validateConnectionConfig({ port: 3306, user: 'root' })).toContain('host is required')
  })

  it('port が範囲外なら検出', () => {
    expect(validateConnectionConfig({ host: 'h', port: 0, user: 'u' })).toContain(
      'port must be between 1 and 65535'
    )
  })

  it('user 欠落を検出', () => {
    expect(validateConnectionConfig({ host: 'h', port: 3306 })).toContain('user is required')
  })
})
