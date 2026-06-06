import { create } from 'zustand'
import type {
  ConnectionProfile,
  ConnectionProfileInput,
  QueryResult,
  AppError,
  ApiResult
} from '../../../shared/types'
import { buildSelectQuery, pickNextActiveTabId } from './helpers'

export interface Tab {
  id: string
  title: string
  sql: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
}

export type Status = 'idle' | 'connecting' | 'connected' | 'error'

function genId(): string {
  return crypto.randomUUID()
}

function makeTab(index: number): Tab {
  return {
    id: genId(),
    title: `Query ${index}`,
    sql: 'SELECT 1 AS one;',
    result: null,
    error: null,
    running: false
  }
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
}

export const useAppStore = create<AppState>((set, get) => ({
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
    const tab = makeTab(1)
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
    const tab = makeTab(tabs.length + 1)
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
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, sql } : t)) })
  },

  async runActiveTab() {
    const { activeTabId, tabs } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    set({ tabs: get().tabs.map((t) => (t.id === tab.id ? { ...t, running: true, error: null } : t)) })
    const res = await window.api.query(tab.sql)
    set({
      tabs: get().tabs.map((t) =>
        t.id === tab.id
          ? {
              ...t,
              running: false,
              result: res.ok ? res.data : null,
              error: res.ok ? null : res.error
            }
          : t
      )
    })
  },

  async selectTable(name) {
    let id = get().activeTabId
    if (!id) {
      const tab = makeTab(1)
      set({ tabs: [tab], activeTabId: tab.id })
      id = tab.id
    }
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, sql: buildSelectQuery(name) } : t)) })
    await get().runActiveTab()
  }
}))
