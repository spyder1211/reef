import { describe, expect, it, vi } from 'vitest'
import { buildConfirmOptions, confirmProductionAction } from './confirmProductionAction'

describe('buildConfirmOptions', () => {
  it('write は OK/キャンセルでチェックボックスなし', () => {
    const o = buildConfirmOptions('write', 'Apply changes', 'prod-db')
    expect(o.buttons).toEqual(['Cancel', 'Run'])
    expect(o.defaultId).toBe(0)
    expect(o.cancelId).toBe(0)
    expect(o.checkboxLabel).toBeUndefined()
    expect(o.message).toContain('prod-db')
    expect(o.message).toContain('Apply changes')
  })
  it('catastrophic はチェックボックス付き（既定 OFF）', () => {
    const o = buildConfirmOptions('catastrophic', 'DROP', 'prod-db')
    expect(o.checkboxLabel).toBe('I understand this is production and want to proceed')
    expect(o.checkboxChecked).toBe(false)
    expect(o.cancelId).toBe(0)
  })
})

describe('confirmProductionAction', () => {
  it('write: 実行ボタンで true', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'write', 'op', 'db', { showMessageBox })
    ).resolves.toBe(true)
  })
  it('write: キャンセルで false', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'write', 'op', 'db', { showMessageBox })
    ).resolves.toBe(false)
  })
  it('catastrophic: チェック無しの実行は false', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'catastrophic', 'op', 'db', { showMessageBox })
    ).resolves.toBe(false)
  })
  it('catastrophic: チェック有りの実行は true', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 1, checkboxChecked: true })
    await expect(
      confirmProductionAction(null, 'catastrophic', 'op', 'db', { showMessageBox })
    ).resolves.toBe(true)
  })
  it('catastrophic: キャンセルは false', async () => {
    const showMessageBox = vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false })
    await expect(
      confirmProductionAction(null, 'catastrophic', 'op', 'db', { showMessageBox })
    ).resolves.toBe(false)
  })
})
