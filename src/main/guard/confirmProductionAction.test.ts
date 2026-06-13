import { describe, it, expect, vi } from 'vitest'
import { buildConfirmOptions, confirmProductionAction } from './confirmProductionAction'

describe('buildConfirmOptions', () => {
  it('write は OK/キャンセルでチェックボックスなし', () => {
    const o = buildConfirmOptions('write', '変更の適用', '本番DB')
    expect(o.buttons).toEqual(['キャンセル', '実行する'])
    expect(o.defaultId).toBe(0)
    expect(o.cancelId).toBe(0)
    expect(o.checkboxLabel).toBeUndefined()
    expect(o.message).toContain('本番DB')
    expect(o.message).toContain('変更の適用')
  })
  it('catastrophic はチェックボックス付き（既定 OFF）', () => {
    const o = buildConfirmOptions('catastrophic', 'DROP', '本番DB')
    expect(o.checkboxLabel).toBe('本番だと理解した上で実行する')
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
})
