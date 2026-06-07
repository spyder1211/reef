import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
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
            <ResultsGrid />
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
