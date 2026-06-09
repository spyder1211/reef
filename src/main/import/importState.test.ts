import { describe, it, expect, beforeEach } from 'vitest'
import {
  setPendingImport,
  consumePendingImport,
  isImporting,
  setImporting
} from './importState'

describe('importState', () => {
  beforeEach(() => {
    // 各テスト前に状態をクリア
    consumePendingImport()
    setImporting(false)
  })

  it('保留パスは consume で1回だけ取得でき、2回目は null', () => {
    setPendingImport('/tmp/a.sql')
    expect(consumePendingImport()).toBe('/tmp/a.sql')
    expect(consumePendingImport()).toBeNull()
  })

  it('実行中フラグを get/set できる', () => {
    expect(isImporting()).toBe(false)
    setImporting(true)
    expect(isImporting()).toBe(true)
  })
})
