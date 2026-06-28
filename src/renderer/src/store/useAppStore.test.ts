import { beforeEach, describe, expect, it } from 'vitest'
import { pkValuesOf, rowKeyOf } from './rowKey'
import type { TableTab } from './useAppStore'
import { useAppStore } from './useAppStore'

function seedTableTab(partial: Partial<TableTab> = {}): string {
  const id = 'tab-test'
  const base: TableTab = {
    kind: 'table',
    id,
    tableName: 'customers',
    columns: ['id', 'name'],
    filters: [],
    appliedFilters: [],
    sort: null,
    pageSize: 100,
    page: 0,
    total: null,
    primaryKey: ['id'],
    edits: {},
    inserts: [],
    deletes: {},
    editError: null,
    selectedRowIndices: [],
    selectionAnchor: null,
    autoIncrementColumns: ['id'],
    view: 'data',
    schema: null,
    schemaError: null,
    result: {
      columns: [
        { name: 'id', type: 'longlong' },
        { name: 'name', type: 'var_string' }
      ],
      rows: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 3, name: 'C' }
      ],
      rowCount: 3,
      durationMs: 0
    },
    error: null,
    running: false,
    canceling: false,
    columnWidths: {},
    ...partial
  }
  useAppStore.setState({ tabs: [base], activeTabId: id })
  return id
}

function tab(id: string): TableTab {
  return useAppStore.getState().tabs.find((t) => t.id === id) as TableTab
}

describe('setSelectedRows', () => {
  beforeEach(() => seedTableTab())
  it('indices と anchor をそのまま設定する', () => {
    useAppStore.getState().setSelectedRows('tab-test', [0, 2], 0)
    expect(tab('tab-test').selectedRowIndices).toEqual([0, 2])
    expect(tab('tab-test').selectionAnchor).toBe(0)
  })
})

describe('stageDeleteMany', () => {
  beforeEach(() => seedTableTab())
  function entriesFor(indices: number[]) {
    // biome-ignore lint/style/noNonNullAssertion: tab result is known to be set from seedTableTab
    const rows = tab('tab-test').result!.rows
    return indices.map((i) => ({
      rowKey: rowKeyOf(['id'], rows[i]),
      pkValues: pkValuesOf(['id'], rows[i])
    }))
  }
  it('未ステージなら全件を deletes に積む', () => {
    useAppStore.getState().stageDeleteMany('tab-test', entriesFor([0, 1]))
    expect(Object.keys(tab('tab-test').deletes)).toHaveLength(2)
  })
  it('全件が既にステージ済みなら全解除する', () => {
    useAppStore.getState().stageDeleteMany('tab-test', entriesFor([0, 1]))
    useAppStore.getState().stageDeleteMany('tab-test', entriesFor([0, 1]))
    expect(Object.keys(tab('tab-test').deletes)).toHaveLength(0)
  })
  it('一部未ステージなら全件を積む（追加側に倒す）', () => {
    useAppStore.getState().stageDeleteMany('tab-test', entriesFor([0]))
    useAppStore.getState().stageDeleteMany('tab-test', entriesFor([0, 1]))
    expect(Object.keys(tab('tab-test').deletes)).toHaveLength(2)
  })
})

describe('duplicateRows', () => {
  beforeEach(() => seedTableTab())
  it('auto_increment 列を除外して inserts に追加する', () => {
    useAppStore.getState().duplicateRows('tab-test', [0])
    const ins = tab('tab-test').inserts
    expect(ins).toHaveLength(1)
    expect(ins[0].values).toEqual({ name: 'A' })
  })
  it('複数行を複製順に追加する', () => {
    useAppStore.getState().duplicateRows('tab-test', [0, 2])
    expect(tab('tab-test').inserts.map((i) => i.values.name)).toEqual(['A', 'C'])
  })
  it('null は null、それ以外は String に変換する', () => {
    useAppStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === 'tab-test' && t.kind === 'table'
          ? // biome-ignore lint/style/noNonNullAssertion: t.result is known to be set from seedTableTab
            { ...t, result: { ...t.result!, rows: [{ id: 9, name: null }] } }
          : t
      )
    }))
    useAppStore.getState().duplicateRows('tab-test', [0])
    expect(tab('tab-test').inserts[0].values).toEqual({ name: null })
  })
})
