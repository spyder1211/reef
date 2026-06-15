import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from './useAppStore'

function resetStore(): void {
  useAppStore.setState({
    tabs: [
      {
        kind: 'sql', id: 'tab-1', title: 'Q', sql: 'SELECT SLEEP(9)',
        result: null, error: null, running: true, canceling: false
      }
    ] as never,
    activeTabId: 'tab-1'
  })
}

describe('cancelTab', () => {
  beforeEach(resetStore)
  afterEach(() => vi.unstubAllGlobals())

  it('cancelQuery を tabId 付きで呼び、canceling を立てる', async () => {
    const cancelQuery = vi.fn(async () => ({ ok: true, data: null }))
    vi.stubGlobal('window', { api: { cancelQuery } })

    await useAppStore.getState().cancelTab('tab-1')

    expect(cancelQuery).toHaveBeenCalledWith('tab-1')
    const tab = useAppStore.getState().tabs.find((t) => t.id === 'tab-1')
    expect(tab?.canceling).toBe(true)
  })
})
