import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'

function seedSqlTab(): void {
  useAppStore.setState({
    tabs: [
      {
        kind: 'sql',
        id: 'tab-1',
        title: 'Q',
        sql: 'SELECT * FROM users',
        result: null,
        error: null,
        running: false,
        canceling: false
      }
    ] as never,
    activeTabId: 'tab-1'
  })
}

describe('SQLタブ 自動LIMIT プラミング', () => {
  beforeEach(seedSqlTab)
  afterEach(() => vi.unstubAllGlobals())

  it('runActiveTab は skipAutoLimit を渡さず実行し、autoLimited を結果に格納する', async () => {
    const queryScript = vi.fn(async () => ({
      ok: true,
      data: { columns: [], rows: [], rowCount: 500, durationMs: 1, autoLimited: true }
    }))
    vi.stubGlobal('window', { api: { queryScript } })

    await useAppStore.getState().runActiveTab()

    expect(queryScript).toHaveBeenCalledWith('tab-1', 'SELECT * FROM users', undefined)
    const tab = useAppStore.getState().tabs.find((t) => t.id === 'tab-1')
    expect((tab as { result: { autoLimited?: boolean } }).result.autoLimited).toBe(true)
  })

  it('rerunWithoutAutoLimit は skipAutoLimit=true で再実行する', async () => {
    const queryScript = vi.fn(async () => ({
      ok: true,
      data: { columns: [], rows: [], rowCount: 600, durationMs: 1 }
    }))
    vi.stubGlobal('window', { api: { queryScript } })

    await useAppStore.getState().rerunWithoutAutoLimit('tab-1')

    expect(queryScript).toHaveBeenCalledWith('tab-1', 'SELECT * FROM users', true)
  })
})
