import { useT } from '../i18n/useT'
import { isProductionProfile } from '../store/helpers'
import { useAppStore } from '../store/useAppStore'
import DetailPane from './DetailPane'
import EditBar from './EditBar'
import FilterBar from './FilterBar'
import HistoryPanel from './HistoryPanel'
import Pager from './Pager'
import QueryEditor from './QueryEditor'
import ResultsGrid from './ResultsGrid'
import SchemaView from './SchemaView'
import Sidebar from './Sidebar'
import SplitGrids from './SplitGrids'
import SqlExportButton from './SqlExportButton'
import StatusBar from './StatusBar'
import TabBar from './TabBar'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
  const { t } = useT()
  const activeKind = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t?.kind ?? null
  })
  const detailOpen = useAppStore((s) => s.detailOpen)
  const toggleDetail = useAppStore((s) => s.toggleDetail)
  const splitView = useAppStore((s) => s.splitView)
  const toggleSplitView = useAppStore((s) => s.toggleSplitView)
  const addInsertRow = useAppStore((s) => s.addInsertRow)
  const setTableView = useAppStore((s) => s.setTableView)
  const historyOpen = useAppStore((s) => s.historyOpen)
  const toggleHistory = useAppStore((s) => s.toggleHistory)
  // 本番環境（tag=production）接続中は最上部に警告バーを出す。
  const isProduction = useAppStore((s) => isProductionProfile(s.activeProfile))
  // ツールバーの行追加ボタン用（主キー有無・実行中で出し分け）。
  const tableTab = useAppStore((s) => {
    const t = s.tabs.find((tt) => tt.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })

  // 表示モード。データビュー固有 UI（フィルタ/グリッド/編集/ページャ/詳細）は data の時のみ出す。
  const view = tableTab?.view ?? 'data'
  const showData = activeKind === 'table' && view === 'data'
  const showStructure = activeKind === 'table' && view === 'structure'

  return (
    <div className={styles.root}>
      {isProduction && (
        <div className={styles.prodBanner} role="alert">
          <span className={styles.prodIcon} aria-hidden="true">
            ⚠
          </span>
          <span className={styles.prodLabel}>PRODUCTION</span>
          <span className={styles.prodText}>{t('workspace.prodBanner')}</span>
        </div>
      )}
      <div className={styles.shell}>
        <Sidebar />
        <div className={styles.mainCol}>
          <TabBar />
          {activeKind === null ? (
            <div className={styles.empty}>{t('workspace.empty')}</div>
          ) : (
            <>
              {activeKind === 'table' ? showData && <FilterBar /> : <QueryEditor />}
              {activeKind === 'table' && (
                <div className={styles.gridToolbar}>
                  <div className={styles.viewToggle}>
                    <button
                      type="button"
                      className={
                        view === 'data'
                          ? `${styles.viewToggleBtn} ${styles.viewToggleBtnOn}`
                          : styles.viewToggleBtn
                      }
                      onClick={() => tableTab && setTableView(tableTab.id, 'data')}
                    >
                      {t('workspace.viewData')}
                    </button>
                    <button
                      type="button"
                      className={
                        view === 'structure'
                          ? `${styles.viewToggleBtn} ${styles.viewToggleBtnOn}`
                          : styles.viewToggleBtn
                      }
                      onClick={() => tableTab && setTableView(tableTab.id, 'structure')}
                    >
                      {t('workspace.viewStructure')}
                    </button>
                  </div>
                  {view === 'data' && (
                    <div className={styles.toolGroup}>
                      {tableTab && tableTab.primaryKey.length > 0 && (
                        <button
                          type="button"
                          className={styles.toolBtn}
                          disabled={tableTab.running}
                          onClick={() => addInsertRow(tableTab.id)}
                          title={t('workspace.addRow')}
                          aria-label={t('workspace.addRow')}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                            <line
                              x1="8"
                              y1="3.5"
                              x2="8"
                              y2="12.5"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                            <line
                              x1="3.5"
                              y1="8"
                              x2="12.5"
                              y2="8"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      )}
                      <button
                        type="button"
                        className={
                          splitView ? `${styles.toolBtn} ${styles.toolBtnOn}` : styles.toolBtn
                        }
                        onClick={() => toggleSplitView()}
                        title={splitView ? t('workspace.splitOn') : t('workspace.splitOff')}
                        aria-label={
                          splitView ? t('workspace.splitAriaOn') : t('workspace.splitAriaOff')
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <rect
                            x="1.5"
                            y="2.5"
                            width="13"
                            height="11"
                            rx="1.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                          />
                          <line
                            x1="8"
                            y1="2.5"
                            x2="8"
                            y2="13.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={
                          detailOpen ? `${styles.toolBtn} ${styles.toolBtnOn}` : styles.toolBtn
                        }
                        onClick={() => toggleDetail()}
                        title={t('workspace.detailToggle')}
                        aria-label={t('workspace.detailToggle')}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <rect
                            x="1.5"
                            y="2.5"
                            width="13"
                            height="11"
                            rx="1.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                          />
                          <line
                            x1="10"
                            y1="2.5"
                            x2="10"
                            y2="13.5"
                            stroke="currentColor"
                            strokeWidth="1.3"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {activeKind === 'sql' && (
                <div className={styles.sqlToolbar}>
                  <SqlExportButton />
                  <button
                    type="button"
                    className={
                      historyOpen ? `${styles.toolBtn} ${styles.toolBtnOn}` : styles.toolBtn
                    }
                    onClick={() => toggleHistory()}
                    title={t('workspace.queryHistory')}
                    aria-label={t('workspace.queryHistory')}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                      <line
                        x1="8"
                        y1="8"
                        x2="8"
                        y2="4.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                      <line
                        x1="8"
                        y1="8"
                        x2="10.5"
                        y2="9.5"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              )}
              {showStructure && tableTab ? (
                <SchemaView tab={tableTab} />
              ) : splitView && activeKind === 'table' ? (
                <SplitGrids />
              ) : (
                <ResultsGrid />
              )}
              {showData && <EditBar />}
              {showData && <Pager />}
              <StatusBar />
            </>
          )}
        </div>
        {detailOpen && showData && <DetailPane />}
        {historyOpen && activeKind === 'sql' && <HistoryPanel />}
      </div>
    </div>
  )
}
