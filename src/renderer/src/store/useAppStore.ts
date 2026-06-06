import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult,
  FilterCondition
} from '../../../shared/types'
import { buildFilteredQuery } from './filterBuilder'
import { pickNextActiveTabId } from './helpers'

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
}

export const useAppStore = create<AppState>((set, get) => {
  async function runSql(tabId: string, sql: string, params?: unknown[]): Promise<void> {
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: true, error: null } : t)) })
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
  }

  async function runTable(tabId: string): Promise<void> {
    const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
    if (!tab) return
    const { sql, params } = buildFilteredQuery(tab.tableName, tab.columns, tab.filters)
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, running: true, error: null } : t)) })
    const res = await window.api.query(sql, params)
    set({
      tabs: get().tabs.map((t) => {
        if (t.id !== tabId || t.kind !== 'table') return t
        if (!res.ok) return { ...t, running: false, result: null, error: res.error }
        const columns = t.columns.length > 0 ? t.columns : res.data.columns.map((c) => c.name)
        return { ...t, running: false, result: res.data, error: null, columns }
      })
    })
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
      else await runTable(tab.id)
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
      await runTable(tab.id)
    },

    addFilter(tabId) {
      set({
        tabs: get().tabs.map((t) => {
          if (t.id !== tabId || t.kind !== 'table') return t
          return { ...t, filters: [...t.filters, makeFilter(t.columns[0] ?? '')] }
        })
      })
    },

    removeFilter(tabId, filterId) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table'
            ? { ...t, filters: t.filters.filter((f) => f.id !== filterId) }
            : t
        )
      })
    },

    updateFilter(tabId, filterId, patch) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table'
            ? {
                ...t,
                filters: t.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f))
              }
            : t
        )
      })
    },

    clearFilters(tabId) {
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId && t.kind === 'table' ? { ...t, filters: [] } : t
        )
      })
    },

    async applyFilters(tabId) {
      await runTable(tabId)
    }
  }
})
