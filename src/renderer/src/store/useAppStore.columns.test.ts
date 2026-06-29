import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QueryResult } from '../../../shared/types'
import type { SqlTab } from './useAppStore'
import { useAppStore } from './useAppStore'

function result(names: string[]): QueryResult {
  return { columns: names.map((name) => ({ name })), rows: [], rowCount: 0, durationMs: 0 }
}
function sqlTab(id: string, names: string[]): SqlTab {
  return {
    kind: 'sql',
    id,
    title: 'Q',
    sql: '',
    result: result(names),
    error: null,
    running: false,
    canceling: false,
    columnWidths: {},
    hiddenColumns: [],
    pinnedColumns: []
  }
}

describe('列の表示制御アクション', () => {
  beforeEach(() => {
    useAppStore.setState({ tabs: [sqlTab('t1', ['a', 'b', 'c'])], activeTabId: 't1' })
  })
  afterEach(() => {
    useAppStore.setState({ tabs: [], activeTabId: null })
  })
  const t1 = () => useAppStore.getState().tabs.find((t) => t.id === 't1')

  it('toggleColumnHidden で設定/解除', () => {
    useAppStore.getState().toggleColumnHidden('t1', 'b')
    expect(t1()?.hiddenColumns).toEqual(['b'])
    useAppStore.getState().toggleColumnHidden('t1', 'b')
    expect(t1()?.hiddenColumns).toEqual([])
  })

  it('最後の可視列は隠せない', () => {
    useAppStore.getState().toggleColumnHidden('t1', 'a')
    useAppStore.getState().toggleColumnHidden('t1', 'b')
    // a,b 非表示で c のみ可視 → c を隠そうとしても拒否
    useAppStore.getState().toggleColumnHidden('t1', 'c')
    expect(t1()?.hiddenColumns).toEqual(['a', 'b'])
  })

  it('toggleColumnPinned は末尾追加/除去', () => {
    useAppStore.getState().toggleColumnPinned('t1', 'c')
    useAppStore.getState().toggleColumnPinned('t1', 'a')
    expect(t1()?.pinnedColumns).toEqual(['c', 'a'])
    useAppStore.getState().toggleColumnPinned('t1', 'c')
    expect(t1()?.pinnedColumns).toEqual(['a'])
  })

  it('showAllColumns で hiddenColumns を空に', () => {
    useAppStore.getState().toggleColumnHidden('t1', 'a')
    useAppStore.getState().showAllColumns('t1')
    expect(t1()?.hiddenColumns).toEqual([])
  })
})
