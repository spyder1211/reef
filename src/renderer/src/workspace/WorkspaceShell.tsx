import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
import SplitGrids from './SplitGrids'
import SchemaView from './SchemaView'
import HistoryPanel from './HistoryPanel'
import EditBar from './EditBar'
import Pager from './Pager'
import StatusBar from './StatusBar'
import DetailPane from './DetailPane'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
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
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.mainCol}>
        <TabBar />
        {activeKind === null ? (
          <div className={styles.empty}>
            左のテーブルを選ぶか「＋」でクエリタブを開いてください
          </div>
        ) : (
          <>
            {activeKind === 'table' ? showData && <FilterBar /> : <QueryEditor />}
            {activeKind === 'table' && (
              <div className={styles.gridToolbar}>
                <div className={styles.viewToggle}>
                  <button
                    className={
                      view === 'data'
                        ? `${styles.viewToggleBtn} ${styles.viewToggleBtnOn}`
                        : styles.viewToggleBtn
                    }
                    onClick={() => tableTab && setTableView(tableTab.id, 'data')}
                  >
                    データ
                  </button>
                  <button
                    className={
                      view === 'structure'
                        ? `${styles.viewToggleBtn} ${styles.viewToggleBtnOn}`
                        : styles.viewToggleBtn
                    }
                    onClick={() => tableTab && setTableView(tableTab.id, 'structure')}
                  >
                    構造
                  </button>
                </div>
                {view === 'data' && (
                  <div className={styles.toolGroup}>
                    {tableTab && tableTab.primaryKey.length > 0 && (
                      <button
                        className={styles.toolBtn}
                        disabled={tableTab.running}
                        onClick={() => addInsertRow(tableTab.id)}
                        title="行を追加"
                        aria-label="行を追加"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <line x1="8" y1="3.5" x2="8" y2="12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                    <button
                      className={splitView ? `${styles.toolBtn} ${styles.toolBtnOn}` : styles.toolBtn}
                      onClick={() => toggleSplitView()}
                      title={splitView ? '分割を解除' : '左右に分割して同じテーブルを見る'}
                      aria-label={splitView ? '分割を解除' : '左右に分割'}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    </button>
                    <button
                      className={detailOpen ? `${styles.toolBtn} ${styles.toolBtnOn}` : styles.toolBtn}
                      onClick={() => toggleDetail()}
                      title="詳細ペインの表示切り替え"
                      aria-label="詳細ペインの表示切り替え"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                        <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}
            {activeKind === 'sql' && (
              <div className={styles.sqlToolbar}>
                <button
                  className={historyOpen ? `${styles.toolBtn} ${styles.toolBtnOn}` : styles.toolBtn}
                  onClick={() => toggleHistory()}
                  title="クエリ履歴"
                  aria-label="クエリ履歴"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <line x1="8" y1="8" x2="8" y2="4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <line x1="8" y1="8" x2="10.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
  )
}
