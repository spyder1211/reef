import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
import SplitGrids from './SplitGrids'
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
  const splitView = useAppStore((s) => s.splitView)
  const toggleSplitView = useAppStore((s) => s.toggleSplitView)

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
            {activeKind === 'table' ? <FilterBar /> : <QueryEditor />}
            {activeKind === 'table' && (
              <div className={styles.gridToolbar}>
                <button
                  className={splitView ? `${styles.splitToggle} ${styles.splitOn}` : styles.splitToggle}
                  onClick={() => toggleSplitView()}
                  title={splitView ? '分割を解除' : '左右に分割して同じテーブルを見る'}
                  aria-label={splitView ? '分割を解除' : '左右に分割'}
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
                    <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </button>
              </div>
            )}
            {splitView && activeKind === 'table' ? <SplitGrids /> : <ResultsGrid />}
            {activeKind === 'table' && <EditBar />}
            {activeKind === 'table' && <Pager />}
            <StatusBar />
          </>
        )}
      </div>
      {detailOpen && activeKind === 'table' && <DetailPane />}
    </div>
  )
}
