import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SqlTab } from './useAppStore'
import { useAppStore } from './useAppStore'

function sqlTab(id: string): SqlTab {
  return {
    kind: 'sql',
    id,
    title: 'Q',
    sql: '',
    result: null,
    error: null,
    running: false,
    canceling: false,
    columnWidths: {}
  }
}

describe('列幅アクション', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [sqlTab('t1'), sqlTab('t2')], activeTabId: 't1' })
  })
  afterEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null })
  })

  it('setColumnWidth が該当タブの columnWidths に設定（クランプ込み）', () => {
    useAppStore.getState().setColumnWidth('t1', 'name', 300)
    useAppStore.getState().setColumnWidth('t1', 'huge', 99999)
    const t1 = useAppStore.getState().tabs.find((t) => t.id === 't1')
    expect(t1?.columnWidths).toEqual({ name: 300, huge: 1200 })
  })

  it('clearColumnWidth が該当列だけ削除', () => {
    useAppStore.getState().setColumnWidth('t1', 'a', 200)
    useAppStore.getState().setColumnWidth('t1', 'b', 250)
    useAppStore.getState().clearColumnWidth('t1', 'a')
    const t1 = useAppStore.getState().tabs.find((t) => t.id === 't1')
    expect(t1?.columnWidths).toEqual({ b: 250 })
  })

  it('別タブには影響しない', () => {
    useAppStore.getState().setColumnWidth('t1', 'a', 200)
    const t2 = useAppStore.getState().tabs.find((t) => t.id === 't2')
    expect(t2?.columnWidths).toEqual({})
  })
})
