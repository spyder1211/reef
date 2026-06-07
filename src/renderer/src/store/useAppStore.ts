import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult,
  FilterCondition,
  TableSort,
  RowEdit,
  PendingInsert
} from '../../../shared/types'
import { buildFilteredQuery, buildCountQuery } from './filterBuilder'
import { buildUpdateStatements, buildInsertStatements, buildDeleteStatements } from './editBuilder'
import { rowKeyOf, pkValuesOf } from './rowKey'
import { pickNextActiveTabId } from './helpers'
import { cycleSort } from './pager'

interface BaseTab {
  id: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
}
export interface SqlTab extends BaseTab {
  kind: 'sql'
  title: string
  sql: string
}
export interface TableTab extends BaseTab {
  kind: 'table'
  tableName: string
  columns: string[]
  filters: FilterCondition[]
  sort: TableSort | null // null = 自然順
  pageSize: number // 50 | 100 | 500（既定 100）
  page: number // 0 始まり（UI 表示は 1 始まり）
  total: number | null // COUNT(*) 由来。未取得は null
  primaryKey: string[] // 主キー列（空 = 読み取り専用）
  edits: Record<string, RowEdit> // 行キー → ステージング中の変更。空 = 変更なし
  inserts: PendingInsert[]                          // INSERT ステージング中の行リスト
  deletes: Record<string, Record<string, unknown>>  // 行キー → pk値（DELETE ステージング）
  editError: AppError | null // コミット失敗のエラー（EditBar に表示）
  selectedRowIndex: number | null // 現在ページ内で選択中の行インデックス。null = 未選択
}
export type Tab = SqlTab | TableTab

export type Status = 'idle' | 'connecting' | 'connected' | 'error'

function genId(): string {
  return crypto.randomUUID()
}

function makeSqlTab(index: number): SqlTab {
  return {
    kind: 'sql',
    id: genId(),
    title: `Query ${index}`,
    sql: 'SELECT 1 AS one;',
    result: null,
    error: null,
    running: false
  }
}

function makeTableTab(name: string): TableTab {
  return {
    kind: 'table',
    id: genId(),
    tableName: name,
    columns: [],
    filters: [],
    sort: null,
    pageSize: 100,
    page: 0,
    total: null,
    primaryKey: [],
    edits: {},
    inserts: [],
    deletes: {},
    editError: null,
    selectedRowIndex: null,
    result: null,
    error: null,
    // 開いた直後は初回クエリ実行中とみなし、結果ペインのプレースホルダ点滅を防ぐ
    running: true
  }
}

function makeFilter(column: string): FilterCondition {
  return { id: genId(), enabled: true, column, operator: '=', value: '', value2: '' }
}

interface AppState {
  profiles: ConnectionProfile[]
  search: string
  status: Status
  connectError: AppError | null
  activeProfile: ConnectionProfile | null
  tables: string[]
  tabs: Tab[]
  activeTabId: string | null
  detailOpen: boolean
  formOpen: boolean
  editingId: string | null

  loadProfiles: () => Promise<void>
  setSearch: (s: string) => void
  openForm: (id?: string) => void
  closeForm: () => void
  saveProfile: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
  deleteProfile: (id: string) => Promise<void>
  connect: (profile: ConnectionProfile) => Promise<void>
  disconnect: () => Promise<void>
  addTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setTabSql: (id: string, sql: string) => void
  runActiveTab: () => Promise<void>
  selectTable: (name: string) => Promise<void>
  addFilter: (tabId: string) => void
  removeFilter: (tabId: string, filterId: string) => void
  updateFilter: (tabId: string, filterId: string, patch: Partial<FilterCondition>) => void
  clearFilters: (tabId: string) => void
  applyFilters: (tabId: string) => Promise<void>
  setSort: (tabId: string, column: string) => Promise<void>
  setPage: (tabId: string, page: number) => Promise<void>
  setPageSize: (tabId: string, size: number) => Promise<void>
  setCellEdit: (tabId: string, row: Record<string, unknown>, column: string, value: string) => void
  setCellNull: (tabId: string, row: Record<string, unknown>, column: string) => void
  discardEdits: (tabId: string) => void
  commitEdits: (tabId: string) => Promise<void>
  addInsertRow: (tabId: string) => void
  updateInsertCell: (tabId: string, localId: string, column: string, value: string) => void
  removeInsertRow: (tabId: string, localId: string) => void
  stageDelete: (tabId: string, rowKey: string, pkValues: Record<string, unknown>) => void
  selectRow: (tabId: string, index: number) => void
  toggleDetail: () => void
}

export const useAppStore = create<AppState>((set, get) => {
  // 未コミットの変更があるとき、ナビゲーション前に破棄してよいか確認する。
  function confirmDiscard(tab: TableTab): boolean {
    if (
      Object.keys(tab.edits).length === 0 &&
      tab.inserts.length === 0 &&
      Object.keys(tab.deletes).length === 0
    ) return true
    return window.confirm('未コミットの変更があります。破棄して移動しますか？')
  }

  function setTabRunning(tabId: string): void {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: true, error: null } : t)) })
  }

  // TableTab のみを id 一致で書き換える共通ヘルパー。
  function patchTableTab(tabId: string, fn: (t: TableTab) => TableTab): void {
    set({
      tabs: get().tabs.map((t) => (t.id === tabId && t.kind === 'table' ? fn(t) : t))
    })
  }

  // 例外（IPC 拒否・クエリ組み立て失敗）でもタブが running のまま固着しないよう error に落とす。
  function failTab(tabId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    set({
      tabs: get().tabs.map((t) =>
        t.id === tabId ? { ...t, running: false, result: null, error: { code: 'CLIENT_ERROR', message } } : t
      )
    })
  }

  async function runSql(tabId: string, sql: string, params?: unknown[]): Promise<void> {
    setTabRunning(tabId)
    try {
      const res = await window.api.query(sql, params)
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                running: false,
                result: res.ok ? res.data : null,
                error: res.ok ? null : res.error
              }
            : t
        )
      })
    } catch (err) {
      failTab(tabId, err)
    }
  }

  async function runTable(tabId: string, opts: { recount: boolean }): Promise<void> {
    const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
    if (!tab) return
    setTabRunning(tabId)
    try {
      const offset = tab.page * tab.pageSize
      const { sql, params } = buildFilteredQuery(tab.tableName, tab.columns, tab.filters, {
        sort: tab.sort,
        limit: tab.pageSize,
        offset
      })
      const res = await window.api.query(sql, params)

      // 件数はフィルタ/テーブル変更時のみ取り直す（ソート・ページ送りでは不変）。
      // ページクエリが失敗したときは COUNT を打たず、直前の total を維持する。
      let total = tab.total
      if (opts.recount && res.ok) {
        const c = buildCountQuery(tab.tableName, tab.columns, tab.filters)
        const cres = await window.api.query(c.sql, c.params)
        // mysql2 は COUNT を bigint で返す場合があるが、現実的な行数なら Number() で安全。
        total = cres.ok ? Number(cres.data.rows[0]?.total ?? 0) : null
      }

      set({
        tabs: get().tabs.map((t) => {
          if (t.id !== tabId || t.kind !== 'table') return t
          if (!res.ok) return { ...t, running: false, result: null, error: res.error }
          const columns = t.columns.length > 0 ? t.columns : res.data.columns.map((col) => col.name)
          return { ...t, running: false, result: res.data, error: null, columns, total }
        })
      })
    } catch (err) {
      failTab(tabId, err)
    }
  }

  return {
    profiles: [],
    search: '',
    status: 'idle',
    connectError: null,
    activeProfile: null,
    tables: [],
    tabs: [],
    activeTabId: null,
    detailOpen: true,
    formOpen: false,
    editingId: null,

    async loadProfiles() {
      const res = await window.api.connections.list()
      if (res.ok) set({ profiles: res.data })
    },

    setSearch(s) {
      set({ search: s })
    },

    openForm(id) {
      set({ formOpen: true, editingId: id ?? null })
    },

    closeForm() {
      set({ formOpen: false, editingId: null })
    },

    async saveProfile(input) {
      const res = await window.api.connections.save(input)
      if (res.ok) await get().loadProfiles()
      return res
    },

    async deleteProfile(id) {
      await window.api.connections.delete(id)
      await get().loadProfiles()
    },

    async connect(profile) {
      set({ status: 'connecting', connectError: null })
      const res = await window.api.connections.connect(profile.id)
      if (!res.ok) {
        set({ status: 'error', connectError: res.error })
        return
      }
      const tab = makeSqlTab(1)
      set({
        status: 'connected',
        activeProfile: profile,
        tabs: [tab],
        activeTabId: tab.id,
        tables: []
      })
      const tbl = await window.api.listTables()
      if (tbl.ok) set({ tables: tbl.data })
    },

    async disconnect() {
      await window.api.disconnect()
      set({
        status: 'idle',
        activeProfile: null,
        tables: [],
        tabs: [],
        activeTabId: null,
        connectError: null
      })
    },

    addTab() {
      const tabs = get().tabs
      const tab = makeSqlTab(tabs.length + 1)
      set({ tabs: [...tabs, tab], activeTabId: tab.id })
    },

    closeTab(id) {
      const { tabs, activeTabId } = get()
      const nextActive = pickNextActiveTabId(tabs, id, activeTabId)
      set({ tabs: tabs.filter((t) => t.id !== id), activeTabId: nextActive })
    },

    setActiveTab(id) {
      set({ activeTabId: id })
    },

    setTabSql(id, sql) {
      set({ tabs: get().tabs.map((t) => (t.id === id && t.kind === 'sql' ? { ...t, sql } : t)) })
    },

    async runActiveTab() {
      const tab = get().tabs.find((t) => t.id === get().activeTabId)
      if (!tab) return
      if (tab.kind === 'sql') await runSql(tab.id, tab.sql)
      else {
        patchTableTab(tab.id, (t) => ({ ...t, selectedRowIndex: null }))
        await runTable(tab.id, { recount: true })
      }
    },

    async selectTable(name) {
      const existing = get().tabs.find(
        (t): t is TableTab => t.kind === 'table' && t.tableName === name
      )
      if (existing) {
        set({ activeTabId: existing.id })
        return
      }
      const tab = makeTableTab(name)
      set({ tabs: [...get().tabs, tab], activeTabId: tab.id })
      const pk = await window.api.primaryKey(name)
      patchTableTab(tab.id, (t) => ({ ...t, primaryKey: pk.ok ? pk.data : [] }))
      await runTable(tab.id, { recount: true })
    },

    addFilter(tabId) {
      patchTableTab(tabId, (t) => ({
        ...t,
        filters: [...t.filters, makeFilter(t.columns[0] ?? '')]
      }))
    },

    removeFilter(tabId, filterId) {
      patchTableTab(tabId, (t) => ({
        ...t,
        filters: t.filters.filter((f) => f.id !== filterId)
      }))
    },

    updateFilter(tabId, filterId, patch) {
      patchTableTab(tabId, (t) => ({
        ...t,
        filters: t.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f))
      }))
    },

    clearFilters(tabId) {
      patchTableTab(tabId, (t) => ({ ...t, filters: [] }))
    },

    async applyFilters(tabId) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({ ...t, page: 0, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null }))
      await runTable(tabId, { recount: true })
    },

    async setSort(tabId, column) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({
        ...t,
        sort: cycleSort(t.sort, column),
        page: 0,
        edits: {},
        inserts: [],
        deletes: {},
        editError: null,
        selectedRowIndex: null
      }))
      await runTable(tabId, { recount: false })
    },

    async setPage(tabId, page) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({ ...t, page: Math.max(0, page), edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null }))
      await runTable(tabId, { recount: false })
    },

    async setPageSize(tabId, size) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      const safe = [50, 100, 500].includes(size) ? size : 100
      patchTableTab(tabId, (t) => ({ ...t, pageSize: safe, page: 0, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null }))
      await runTable(tabId, { recount: false })
    },

    setCellEdit(tabId, row, column, value) {
      patchTableTab(tabId, (t) => {
        if (t.primaryKey.length === 0) return t
        const key = rowKeyOf(t.primaryKey, row)
        const existing = t.edits[key] ?? { pk: pkValuesOf(t.primaryKey, row), values: {} }
        const values = { ...existing.values }
        const original = row[column]
        // オリジナルと同じ値なら変更扱いしない（ハイライト解除）
        if (original !== null && original !== undefined && String(original) === value) {
          delete values[column]
        } else {
          values[column] = value
        }
        const edits = { ...t.edits }
        if (Object.keys(values).length === 0) delete edits[key]
        else edits[key] = { pk: existing.pk, values }
        return { ...t, edits, editError: null }
      })
    },

    setCellNull(tabId, row, column) {
      patchTableTab(tabId, (t) => {
        if (t.primaryKey.length === 0) return t
        const key = rowKeyOf(t.primaryKey, row)
        const existing = t.edits[key] ?? { pk: pkValuesOf(t.primaryKey, row), values: {} }
        const values = { ...existing.values }
        // すでに NULL なら変更扱いしない
        if (row[column] === null) delete values[column]
        else values[column] = null
        const edits = { ...t.edits }
        if (Object.keys(values).length === 0) delete edits[key]
        else edits[key] = { pk: existing.pk, values }
        return { ...t, edits, editError: null }
      })
    },

    discardEdits(tabId) {
      patchTableTab(tabId, (t) => ({ ...t, edits: {}, inserts: [], deletes: {}, editError: null }))
    },

    addInsertRow(tabId) {
      const localId = `ins-${crypto.randomUUID()}`
      patchTableTab(tabId, (t) => ({
        ...t,
        inserts: [...t.inserts, { localId, values: {} }],
        editError: null,
      }))
    },

    updateInsertCell(tabId, localId, column, value) {
      patchTableTab(tabId, (t) => ({
        ...t,
        inserts: t.inserts.map((ins) =>
          ins.localId === localId
            ? { ...ins, values: { ...ins.values, [column]: value } }
            : ins
        ),
        editError: null,
      }))
    },

    removeInsertRow(tabId, localId) {
      patchTableTab(tabId, (t) => ({
        ...t,
        inserts: t.inserts.filter((ins) => ins.localId !== localId),
        editError: null,
      }))
    },

    stageDelete(tabId, rowKey, pkValues) {
      patchTableTab(tabId, (t) => {
        const deletes = { ...t.deletes }
        if (rowKey in deletes) {
          delete deletes[rowKey] // トグル：すでに削除ステージング済みなら取り消す
        } else {
          deletes[rowKey] = pkValues
        }
        return { ...t, deletes, editError: null }
      })
    },

    async commitEdits(tabId) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      const hasChanges =
        tab &&
        (Object.keys(tab.edits).length > 0 ||
          tab.inserts.length > 0 ||
          Object.keys(tab.deletes).length > 0)
      if (!tab || tab.running || !hasChanges) return

      // 順序: DELETE → UPDATE → INSERT（FK 制約違反を最小化）
      const statements = [
        ...buildDeleteStatements(tab.tableName, tab.primaryKey, tab.deletes),
        ...buildUpdateStatements(tab.tableName, tab.primaryKey, Object.values(tab.edits)),
        ...buildInsertStatements(tab.tableName, tab.inserts),
      ]
      if (statements.length === 0) return
      setTabRunning(tabId)
      try {
        const res = await window.api.applyChanges(statements)
        if (!res.ok) {
          // 失敗時はグリッドを潰さず EditBar にエラー表示。ステージは保持して再試行可能。
          set({
            tabs: get().tabs.map((t) =>
              t.id === tabId && t.kind === 'table'
                ? { ...t, running: false, editError: res.error }
                : t
            )
          })
          return
        }
        patchTableTab(tabId, (t) => ({
          ...t, edits: {}, inserts: [], deletes: {}, editError: null, selectedRowIndex: null
        }))
        await runTable(tabId, { recount: true }) // INSERT/DELETE は行数が変わる
      } catch (err) {
        failTab(tabId, err)
      }
    },

    selectRow(tabId, index) {
      patchTableTab(tabId, (t) => ({ ...t, selectedRowIndex: index }))
    },

    toggleDetail() {
      set({ detailOpen: !get().detailOpen })
    }
  }
})
