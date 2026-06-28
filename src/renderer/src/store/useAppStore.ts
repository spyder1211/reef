import { create } from 'zustand'
import { createTranslator } from '../../../shared/i18n'
import type { Locale, LocalePreference } from '../../../shared/i18n/types'
import type {
  ApiResult,
  AppError,
  ConnectionGroup,
  ConnectionProfile,
  ConnectionProfileInput,
  FilterCondition,
  FilterOperator,
  PendingInsert,
  QueryResult,
  RowEdit,
  TableSchema,
  TableSort
} from '../../../shared/types'
import { toCsv } from '../lib/csv'
import {
  buildDeleteStatements,
  buildDropStatement,
  buildInsertStatements,
  buildTruncateStatement,
  buildUpdateStatements
} from './editBuilder'
import { singleStatementOf } from './explain'
import { buildCountQuery, buildFilteredQuery } from './filterBuilder'
import {
  clearedStaging,
  hasUncommittedChanges,
  isCancelled,
  isProductionProfile,
  pickNextActiveTabId
} from './helpers'
import { cycleSort } from './pager'
import { pkValuesOf, rowKeyOf } from './rowKey'

interface BaseTab {
  id: string
  result: QueryResult | null
  error: AppError | null
  running: boolean
  canceling: boolean // 停止要求送信中（停止ボタンの「停止中…」表示用）
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
  appliedFilters: FilterCondition[] // いま表示中の結果を生んだフィルタのスナップショット
  sort: TableSort | null // null = 自然順
  pageSize: number // 50 | 100 | 500（既定 100）
  page: number // 0 始まり（UI 表示は 1 始まり）
  total: number | null // COUNT(*) 由来。未取得は null
  primaryKey: string[] // 主キー列（空 = 読み取り専用）
  edits: Record<string, RowEdit> // 行キー → ステージング中の変更。空 = 変更なし
  inserts: PendingInsert[] // INSERT ステージング中の行リスト
  deletes: Record<string, Record<string, unknown>> // 行キー → pk値（DELETE ステージング）
  editError: AppError | null // コミット失敗のエラー（EditBar に表示）
  selectedRowIndices: number[] // 選択中の行インデックス（統一インデックス空間: 結果行→INSERT行）
  selectionAnchor: number | null // Shift 範囲選択の起点。null = 未設定
  autoIncrementColumns: string[] // auto_increment 列名（複製で除外）
  view: 'data' | 'structure' // 表示モード。既定 'data'
  schema: TableSchema | null // 構造ビュー用。未取得は null（lazy load）
  schemaError: AppError | null // 構造取得失敗のエラー
}
export type Tab = SqlTab | TableTab

export type Status = 'idle' | 'connecting' | 'connected' | 'error'

// exportCsv の結果（UI のフィードバック用）。message は成功時の表示文言（空なら表示しない）。
export type ExportCsvResult =
  | { ok: true; canceled?: boolean; message: string }
  | { ok: false; message: string }

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
    running: false,
    canceling: false
  }
}

function makeTableTab(name: string): TableTab {
  return {
    kind: 'table',
    id: genId(),
    tableName: name,
    columns: [],
    filters: [],
    appliedFilters: [],
    sort: null,
    pageSize: 100,
    page: 0,
    total: null,
    primaryKey: [],
    edits: {},
    inserts: [],
    deletes: {},
    editError: null,
    selectedRowIndices: [],
    selectionAnchor: null,
    autoIncrementColumns: [],
    view: 'data',
    schema: null,
    schemaError: null,
    result: null,
    error: null,
    // 開いた直後は初回クエリ実行中とみなし、結果ペインのプレースホルダ点滅を防ぐ
    running: true,
    canceling: false
  }
}

function makeFilter(column: string): FilterCondition {
  return { id: genId(), enabled: true, column, operator: '=', value: '', value2: '' }
}

interface AppState {
  profiles: ConnectionProfile[]
  search: string
  groups: ConnectionGroup[]
  collapsed: Record<string, boolean> // key=groupId（未分類は UNGROUPED_ID）, true=折り畳み
  status: Status
  connectError: AppError | null
  activeProfile: ConnectionProfile | null
  tables: string[]
  schemaMap: Record<string, string[]> // SQL 補完用：テーブル名→カラム名[]（接続中のみ）
  tabs: Tab[]
  activeTabId: string | null
  detailOpen: boolean
  splitView: boolean
  historyOpen: boolean // SQL タブのクエリ履歴パネル開閉
  formOpen: boolean
  editingId: string | null
  locale: Locale
  localePreference: LocalePreference
  setLocalePreference: (pref: LocalePreference) => Promise<void>

  loadProfiles: () => Promise<void>
  setSearch: (s: string) => void
  openForm: (id?: string) => void
  closeForm: () => void
  saveProfile: (input: ConnectionProfileInput) => Promise<ApiResult<ConnectionProfile>>
  duplicateProfile: (id: string) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  loadGroups: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  reorderGroups: (orderedIds: string[]) => Promise<void>
  moveProfileToGroup: (profileId: string, groupId: string | null) => Promise<void>
  toggleCollapse: (groupId: string) => void
  connect: (profile: ConnectionProfile) => Promise<void>
  disconnect: () => Promise<void>
  returnToConnections: () => Promise<void>
  addTab: () => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setTabSql: (id: string, sql: string) => void
  runActiveTab: () => Promise<void>
  rerunWithoutAutoLimit: (tabId: string) => Promise<void>
  cancelTab: (tabId: string) => Promise<void>
  explainActiveTab: () => Promise<void>
  selectTable: (name: string) => Promise<void>
  setTableView: (tabId: string, view: 'data' | 'structure') => Promise<void>
  truncateTable: (name: string) => Promise<void>
  dropTable: (name: string) => Promise<void>
  addFilter: (tabId: string) => void
  removeFilter: (tabId: string, filterId: string) => void
  updateFilter: (tabId: string, filterId: string, patch: Partial<FilterCondition>) => void
  clearFilters: (tabId: string) => void
  applyFilters: (tabId: string) => Promise<void>
  duplicateFilter: (tabId: string, filterId: string) => void
  quickFilter: (
    tabId: string,
    column: string,
    operator: FilterOperator,
    value: unknown
  ) => Promise<void>
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
  setSelectedRows: (tabId: string, indices: number[], anchor: number | null) => void
  stageDeleteMany: (
    tabId: string,
    entries: { rowKey: string; pkValues: Record<string, unknown> }[]
  ) => void
  duplicateRows: (tabId: string, rowIndices: number[]) => void
  exportCsv: (
    tabId: string,
    opts: { scope: 'page' | 'all'; target: 'file' | 'clipboard' }
  ) => Promise<ExportCsvResult>
  exportSqlResultCsv: (tabId: string) => Promise<ExportCsvResult>
  toggleDetail: () => void
  toggleSplitView: () => void
  toggleHistory: () => void
}

export const useAppStore = create<AppState>((set, get) => {
  // 未コミットの変更があるとき、ナビゲーション前に破棄してよいか確認する。
  function confirmDiscard(tab: TableTab): boolean {
    if (!hasUncommittedChanges(tab)) return true
    const { t } = createTranslator(get().locale)
    return window.confirm(t('store.confirmDiscard'))
  }

  function setTabRunning(tabId: string): void {
    set({
      tabs: get().tabs.map((t) =>
        t.id === tabId ? { ...t, running: true, canceling: false, error: null } : t
      )
    })
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
        t.id === tabId
          ? {
              ...t,
              running: false,
              canceling: false,
              result: null,
              error: { code: 'CLIENT_ERROR', message }
            }
          : t
      )
    })
  }

  // テーブル一覧を再取得してストアへ反映する。connect と dropTable で共有する。
  // SQL 補完用の schemaMap も併せて更新し、DROP/TRUNCATE 後も補完候補を同期させる。
  async function refreshTables(): Promise<void> {
    const tbl = await window.api.listTables()
    if (tbl.ok) set({ tables: tbl.data })
    const sm = await window.api.schemaMap()
    set({ schemaMap: sm.ok ? sm.data : {} })
  }

  async function runSql(
    tabId: string,
    sql: string,
    opts?: { skipAutoLimit?: boolean }
  ): Promise<void> {
    setTabRunning(tabId)
    try {
      // SQL エディタは複数文を1回で全実行する（; で分割して逐次実行）。
      const res = await window.api.queryScript(tabId, sql, opts?.skipAutoLimit)
      if (isCancelled(res)) {
        // 本番ガードでキャンセル: 実行前なので結果は変えず running だけ戻す。
        // SqlTab は patchTableTab（table 専用）が使えないため直接 set で running だけ戻す。
        set({
          tabs: get().tabs.map((t) =>
            t.id === tabId ? { ...t, running: false, canceling: false } : t
          )
        })
        return
      }
      set({
        tabs: get().tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                running: false,
                canceling: false,
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
      const res = await window.api.query(tabId, sql, params)
      if (isCancelled(res)) {
        patchTableTab(tabId, (t) => ({ ...t, running: false, canceling: false }))
        return
      }

      // 件数はフィルタ/テーブル変更時のみ取り直す（ソート・ページ送りでは不変）。
      // ページクエリが失敗したときは COUNT を打たず、直前の total を維持する。
      let total = tab.total
      if (opts.recount && res.ok) {
        const c = buildCountQuery(tab.tableName, tab.columns, tab.filters)
        // COUNT は内部クエリのため tabId を渡さない（空 tabId = 非キャンセル対象）。
        const cres = await window.api.query('', c.sql, c.params)
        // mysql2 は COUNT を bigint で返す場合があるが、現実的な行数なら Number() で安全。
        total = cres.ok ? Number(cres.data.rows[0]?.total ?? 0) : null
      }

      set({
        tabs: get().tabs.map((t) => {
          if (t.id !== tabId || t.kind !== 'table') return t
          if (!res.ok)
            return { ...t, running: false, canceling: false, result: null, error: res.error }
          const columns = t.columns.length > 0 ? t.columns : res.data.columns.map((col) => col.name)
          return {
            ...t,
            running: false,
            canceling: false,
            result: res.data,
            error: null,
            columns,
            total
          }
        })
      })
    } catch (err) {
      failTab(tabId, err)
    }
  }

  // 実行中クエリの停止要求を送る。running の解除は、停止された query/queryScript が
  // CANCELLED で解決した時に runSql/runTable 側で行われる（ここでは canceling だけ立てる）。
  async function cancelTab(tabId: string): Promise<void> {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab?.running || tab.canceling) return
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, canceling: true } : t)) })
    await window.api.cancelQuery(tabId)
  }

  return {
    profiles: [],
    search: '',
    groups: [],
    collapsed: {},
    status: 'idle',
    connectError: null,
    activeProfile: null,
    tables: [],
    schemaMap: {},
    tabs: [],
    activeTabId: null,
    detailOpen: true,
    splitView: false,
    historyOpen: false,
    formOpen: false,
    editingId: null,
    locale: window.api.i18n.bootstrap.effective,
    localePreference: window.api.i18n.bootstrap.preference,
    async setLocalePreference(pref) {
      const { effective } = await window.api.i18n.setLocale(pref)
      set({ localePreference: pref, locale: effective })
    },

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

    async duplicateProfile(id) {
      const res = await window.api.connections.duplicate(id)
      if (res.ok) await get().loadProfiles()
    },

    async deleteProfile(id) {
      await window.api.connections.delete(id)
      await get().loadProfiles()
    },

    async loadGroups() {
      const res = await window.api.groups.list()
      if (res.ok) set({ groups: res.data })
    },

    async createGroup(name) {
      const res = await window.api.groups.create(name)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
    },

    async renameGroup(id, name) {
      const res = await window.api.groups.rename(id, name)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
    },

    async deleteGroup(id) {
      const res = await window.api.groups.delete(id)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
      await get().loadProfiles()
    },

    async reorderGroups(orderedIds) {
      const res = await window.api.groups.reorder(orderedIds)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadGroups()
    },

    async moveProfileToGroup(profileId, groupId) {
      const current = get().profiles.find((p) => p.id === profileId)
      if (current && (current.groupId ?? null) === groupId) return // 既に同じ所属なら何もしない
      const res = await window.api.connections.move(profileId, groupId)
      if (!res.ok) {
        window.alert(res.error.message)
        return
      }
      await get().loadProfiles()
    },

    toggleCollapse(groupId) {
      set((s) => ({ collapsed: { ...s.collapsed, [groupId]: !s.collapsed[groupId] } }))
    },

    async connect(profile) {
      // 接続処理中の再入（ダブルクリック/ボタン連打）を弾く。
      if (get().status === 'connecting') return
      // 本番環境は誤操作の影響が大きいため、テーブル一覧を開く前に毎回確認を挟む。
      // キャンセルされたら接続自体を行わず、接続一覧にとどまる。
      if (isProductionProfile(profile)) {
        const { t } = createTranslator(get().locale)
        const ok = window.confirm(t('store.confirmProdConnect', { name: profile.name }))
        if (!ok) return
      }
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
      await refreshTables()
    },

    async disconnect() {
      await window.api.disconnect()
      set({
        status: 'idle',
        activeProfile: null,
        tables: [],
        schemaMap: {},
        tabs: [],
        activeTabId: null,
        connectError: null
      })
    },

    // ウィンドウの閉じる操作（接続中）から呼ばれる。未コミット変更があれば確認し、
    // 問題なければ接続を切って接続一覧（HomeScreen）へ戻す。
    async returnToConnections() {
      if (get().status !== 'connected') return
      const hasChanges = get().tabs.some((t) => hasUncommittedChanges(t))
      if (hasChanges) {
        const { t } = createTranslator(get().locale)
        if (!window.confirm(t('store.confirmDiscardReturn'))) return
      }
      await get().disconnect()
    },

    addTab() {
      const tabs = get().tabs
      const tab = makeSqlTab(tabs.length + 1)
      set({ tabs: [...tabs, tab], activeTabId: tab.id })
    },

    closeTab(id) {
      const { tabs, activeTabId } = get()
      // 閉じる対象は id 指定のタブ（アクティブとは限らない）。未コミット変更があれば確認する。
      const target = tabs.find((t) => t.id === id)
      if (target && hasUncommittedChanges(target)) {
        const { t } = createTranslator(get().locale)
        if (!window.confirm(t('store.confirmDiscardClose'))) return
      }
      const nextActive = pickNextActiveTabId(tabs, id, activeTabId)
      set({ tabs: tabs.filter((t) => t.id !== id), activeTabId: nextActive })
    },

    setActiveTab(id) {
      set({ activeTabId: id })
    },

    setTabSql(id, sql) {
      set({ tabs: get().tabs.map((t) => (t.id === id && t.kind === 'sql' ? { ...t, sql } : t)) })
    },

    // アクティブ SQL タブのクエリを EXPLAIN 実行する（単一文のみ）。
    // 履歴を汚さないよう queryScript ではなく query を直接使う。
    async explainActiveTab() {
      const tab = get().tabs.find((t) => t.id === get().activeTabId)
      if (tab?.kind !== 'sql') return
      const stmt = singleStatementOf(tab.sql)
      if (!stmt) {
        const { t } = createTranslator(get().locale)
        set({
          tabs: get().tabs.map((tt) =>
            tt.id === tab.id
              ? {
                  ...tt,
                  result: null,
                  error: {
                    code: 'EXPLAIN_MULTI',
                    message: t('store.explainMultiError'),
                    messageKey: 'store.explainMultiError'
                  }
                }
              : tt
          )
        })
        return
      }
      setTabRunning(tab.id)
      try {
        const res = await window.api.query('', `EXPLAIN ${stmt}`)
        set({
          tabs: get().tabs.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  running: false,
                  canceling: false,
                  result: res.ok ? res.data : null,
                  error: res.ok ? null : res.error
                }
              : t
          )
        })
      } catch (err) {
        failTab(tab.id, err)
      }
    },

    async runActiveTab() {
      const tab = get().tabs.find((t) => t.id === get().activeTabId)
      if (!tab) return
      if (tab.kind === 'sql') await runSql(tab.id, tab.sql)
      else {
        // reload では構造キャッシュも破棄し、次に structure を開いた時に再取得させる（ALTER 後の陳腐化対策）。
        patchTableTab(tab.id, (t) => ({
          ...t,
          selectedRowIndices: [],
          selectionAnchor: null,
          schema: null,
          schemaError: null
        }))
        await runTable(tab.id, { recount: true })
      }
    },

    // 注記の「自動LIMITを外して再実行」ボタン用。同じ SQL を skipAutoLimit=true で再実行する。
    async rerunWithoutAutoLimit(tabId: string) {
      const tab = get().tabs.find((t) => t.id === tabId)
      if (tab?.kind !== 'sql') return
      await runSql(tabId, tab.sql, { skipAutoLimit: true })
    },

    cancelTab,

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
      const [pk, ai] = await Promise.all([
        window.api.primaryKey(name),
        window.api.autoIncrementColumns(name)
      ])
      patchTableTab(tab.id, (t) => ({
        ...t,
        primaryKey: pk.ok ? pk.data : [],
        autoIncrementColumns: ai.ok ? ai.data : []
      }))
      await runTable(tab.id, { recount: true })
    },

    // 表示モードを切り替える。structure へ切り替え時、未取得ならスキーマを lazy load する。
    async setTableView(tabId, view) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab) return
      patchTableTab(tabId, (t) => ({ ...t, view }))
      if (view === 'structure' && !tab.schema) {
        const res = await window.api.tableSchema(tab.tableName)
        patchTableTab(tabId, (t) =>
          res.ok ? { ...t, schema: res.data, schemaError: null } : { ...t, schemaError: res.error }
        )
      }
    },

    async truncateTable(name) {
      const { t } = createTranslator(get().locale)
      if (!window.confirm(t('store.confirmTruncate', { name }))) {
        return
      }
      try {
        const { sql, params } = buildTruncateStatement(name)
        const res = await window.api.query('', sql, params)
        if (isCancelled(res)) return // 本番ガードでキャンセル: 何もしない
        if (!res.ok) {
          window.alert(res.error.message)
          return
        }
        // 該当テーブルの開いているタブ（selectTable が同名タブを再利用するため最大1つ）の
        // ステージをクリアして再描画する。クリアしないと消えた行に対する UPDATE/DELETE が残る。
        const tab = get().tabs.find(
          (t): t is TableTab => t.kind === 'table' && t.tableName === name
        )
        if (tab) {
          patchTableTab(tab.id, (t) => ({
            ...t,
            ...clearedStaging(),
            page: 0
          }))
          await runTable(tab.id, { recount: true })
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
    },

    async dropTable(name) {
      const { t } = createTranslator(get().locale)
      if (!window.confirm(t('store.confirmDrop', { name }))) {
        return
      }
      try {
        const { sql, params } = buildDropStatement(name)
        const res = await window.api.query('', sql, params)
        if (isCancelled(res)) return // 本番ガードでキャンセル: 何もしない
        if (!res.ok) {
          window.alert(res.error.message)
          return
        }
        // 該当テーブル名のタブ（最大1つ）を確認なしで閉じる（テーブルごと消えるため編集ステージは無意味）。
        const { tabs, activeTabId } = get()
        const target = tabs.find((t) => t.kind === 'table' && t.tableName === name)
        if (target) {
          const nextActive = pickNextActiveTabId(tabs, target.id, activeTabId)
          set({ tabs: tabs.filter((t) => t.id !== target.id), activeTabId: nextActive })
        }
        await refreshTables()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err))
      }
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
      // appliedFilters も空にして Clear→Apply 間の一瞬の未適用(dirty)ちらつきを防ぐ
      patchTableTab(tabId, (t) => ({ ...t, filters: [], appliedFilters: [] }))
    },

    async applyFilters(tabId) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({
        ...t,
        appliedFilters: t.filters,
        page: 0,
        ...clearedStaging()
      }))
      await runTable(tabId, { recount: true })
    },

    duplicateFilter(tabId, filterId) {
      patchTableTab(tabId, (t) => {
        const idx = t.filters.findIndex((f) => f.id === filterId)
        if (idx === -1) return t
        const clone = { ...t.filters[idx], id: genId() }
        return {
          ...t,
          filters: [...t.filters.slice(0, idx + 1), clone, ...t.filters.slice(idx + 1)]
        }
      })
    },

    async quickFilter(tabId, column, operator, value) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      const valueless = operator === 'is_null' || operator === 'is_not_null'
      const cond: FilterCondition = {
        id: genId(),
        enabled: true,
        column,
        operator,
        value: valueless ? '' : value == null ? '' : String(value),
        value2: ''
      }
      patchTableTab(tabId, (t) => {
        const filters = [...t.filters, cond]
        return {
          ...t,
          filters,
          appliedFilters: filters,
          page: 0,
          ...clearedStaging()
        }
      })
      await runTable(tabId, { recount: true })
    },

    async setSort(tabId, column) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({
        ...t,
        sort: cycleSort(t.sort, column),
        page: 0,
        ...clearedStaging()
      }))
      await runTable(tabId, { recount: false })
    },

    async setPage(tabId, page) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      patchTableTab(tabId, (t) => ({
        ...t,
        page: Math.max(0, page),
        ...clearedStaging()
      }))
      await runTable(tabId, { recount: false })
    },

    async setPageSize(tabId, size) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      if (!tab || !confirmDiscard(tab)) return
      const safe = [50, 100, 500].includes(size) ? size : 100
      patchTableTab(tabId, (t) => ({
        ...t,
        pageSize: safe,
        page: 0,
        ...clearedStaging()
      }))
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
        editError: null
      }))
    },

    updateInsertCell(tabId, localId, column, value) {
      patchTableTab(tabId, (t) => ({
        ...t,
        inserts: t.inserts.map((ins) =>
          ins.localId === localId ? { ...ins, values: { ...ins.values, [column]: value } } : ins
        ),
        editError: null
      }))
    },

    removeInsertRow(tabId, localId) {
      patchTableTab(tabId, (t) => ({
        ...t,
        inserts: t.inserts.filter((ins) => ins.localId !== localId),
        // 破棄で INSERT 行の数が変わると selectedRowIndices が無効な位置を指すため選択を解除する。
        selectedRowIndices: [],
        selectionAnchor: null,
        editError: null
      }))
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
        ...buildInsertStatements(tab.tableName, tab.inserts)
      ]
      if (statements.length === 0) {
        // ステージはあるが実行すべき文が無い（例: 空欄だけの INSERT 行）。
        // 黙って無反応になると詰むため、入力を促すエラーを表示する。
        const { t } = createTranslator(get().locale)
        patchTableTab(tabId, (tt) => ({
          ...tt,
          editError: {
            code: 'CLIENT_ERROR',
            message: t('store.noInputToCommit'),
            messageKey: 'store.noInputToCommit'
          }
        }))
        return
      }
      setTabRunning(tabId)
      try {
        const res = await window.api.applyChanges(statements)
        if (isCancelled(res)) {
          // 本番ガードでキャンセル: ステージング変更は保持し running だけ戻す。
          patchTableTab(tabId, (t) => ({ ...t, running: false, canceling: false }))
          return
        }
        if (!res.ok) {
          // 失敗時はグリッドを潰さず EditBar にエラー表示。ステージは保持して再試行可能。
          set({
            tabs: get().tabs.map((t) =>
              t.id === tabId && t.kind === 'table'
                ? { ...t, running: false, canceling: false, editError: res.error }
                : t
            )
          })
          return
        }
        patchTableTab(tabId, (t) => ({
          ...t,
          ...clearedStaging()
        }))
        await runTable(tabId, { recount: true }) // INSERT/DELETE は行数が変わる
      } catch (err) {
        failTab(tabId, err)
      }
    },

    setSelectedRows(tabId, indices, anchor) {
      patchTableTab(tabId, (t) => ({ ...t, selectedRowIndices: indices, selectionAnchor: anchor }))
    },

    stageDeleteMany(tabId, entries) {
      patchTableTab(tabId, (t) => {
        if (entries.length === 0) return t
        const deletes = { ...t.deletes }
        const edits = { ...t.edits }
        const allStaged = entries.every((e) => e.rowKey in deletes)
        if (allStaged) {
          for (const e of entries) delete deletes[e.rowKey]
        } else {
          for (const e of entries) {
            deletes[e.rowKey] = e.pkValues
            delete edits[e.rowKey] // DELETE 後の UPDATE は無意味なので破棄
          }
        }
        return { ...t, deletes, edits, editError: null }
      })
    },

    duplicateRows(tabId, rowIndices) {
      patchTableTab(tabId, (t) => {
        if (!t.result) return t
        const exclude = new Set(t.autoIncrementColumns)
        const colNames = t.result.columns.map((c) => c.name)
        const newInserts: PendingInsert[] = []
        for (const idx of rowIndices) {
          const row = t.result.rows[idx]
          if (!row) continue
          const values: Record<string, string | null> = {}
          for (const c of colNames) {
            if (exclude.has(c)) continue
            const v = row[c]
            // 空文字は buildInsertStatements でDBデフォルト扱いになる（既存の INSERT 仕様に合わせる）
            values[c] = v === null || v === undefined ? null : String(v)
          }
          newInserts.push({ localId: `ins-${crypto.randomUUID()}`, values })
        }
        return { ...t, inserts: [...t.inserts, ...newInserts], editError: null }
      })
    },

    async exportCsv(tabId, opts) {
      const tab = get().tabs.find((t): t is TableTab => t.id === tabId && t.kind === 'table')
      const { t } = createTranslator(get().locale)
      if (!tab?.result) {
        return { ok: false, message: t('store.exportNoResult') }
      }

      // 全件は重くなり得るため、件数が分かっていればフェッチ前に確認する。
      const EXPORT_CONFIRM_THRESHOLD = 50000
      let confirmedLarge = false
      if (opts.scope === 'all' && tab.total !== null && tab.total > EXPORT_CONFIRM_THRESHOLD) {
        if (!window.confirm(t('store.confirmExportLarge', { count: String(tab.total) }))) {
          return { ok: true, canceled: true, message: '' }
        }
        confirmedLarge = true
      }

      // 列と行を決定する。
      let columns: string[]
      let rows: Record<string, unknown>[]
      if (opts.scope === 'page') {
        // 既読み込みの現在ページ・現在のソートをそのまま使う（追加クエリなし）。
        columns = tab.result.columns.map((c) => c.name)
        rows = tab.result.rows
      } else {
        // 全件: LIMIT を外して再取得する。tab.running は立てず、グリッド表示を維持する。
        const { sql, params } = buildFilteredQuery(tab.tableName, tab.columns, tab.filters, {
          sort: tab.sort,
          limit: null
        })
        try {
          const res = await window.api.query('', sql, params)
          if (!res.ok) return { ok: false, message: res.error.message }
          columns = res.data.columns.map((c) => c.name)
          rows = res.data.rows
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
      }

      // tab.total が未カウント/古い場合のフォールバック: 実際の取得行数で確認する（事前確認済みなら省略）。
      if (opts.scope === 'all' && !confirmedLarge && rows.length > EXPORT_CONFIRM_THRESHOLD) {
        if (!window.confirm(t('store.confirmExportLarge', { count: String(rows.length) }))) {
          return { ok: true, canceled: true, message: '' }
        }
      }

      const csv = toCsv(columns, rows)

      if (opts.target === 'clipboard') {
        try {
          await navigator.clipboard.writeText(csv)
          return { ok: true, message: t('store.exportCopied') }
        } catch (err) {
          return { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
      }

      // target: 'file'
      try {
        const res = await window.api.saveCsv(`${tab.tableName}.csv`, csv)
        if (!res.ok) return { ok: false, message: res.error.message }
        if (res.data.canceled) return { ok: true, canceled: true, message: '' }
        const name = res.data.filePath?.split('/').pop() ?? res.data.filePath ?? ''
        return { ok: true, message: t('store.exportSaved', { name }) }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },

    // SQL タブの現在の結果を CSV 保存する。結果が無ければ何もしない。
    async exportSqlResultCsv(tabId) {
      const { t } = createTranslator(get().locale)
      const tab = get().tabs.find((tt) => tt.id === tabId)
      if (tab?.kind !== 'sql' || !tab.result || tab.result.rows.length === 0) {
        return { ok: false, message: t('store.exportSqlNoResult') }
      }
      const columns = tab.result.columns.map((c) => c.name)
      const csv = toCsv(columns, tab.result.rows)
      try {
        const res = await window.api.saveCsv(`${tab.title}.csv`, csv)
        if (!res.ok) return { ok: false, message: res.error.message }
        if (res.data.canceled) return { ok: true, canceled: true, message: '' }
        const name = res.data.filePath?.split('/').pop() ?? res.data.filePath ?? ''
        return { ok: true, message: t('store.exportSaved', { name }) }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },

    toggleDetail() {
      set({ detailOpen: !get().detailOpen })
    },

    toggleSplitView() {
      set({ splitView: !get().splitView })
    },

    toggleHistory() {
      set({ historyOpen: !get().historyOpen })
    }
  }
})
