import { useAppStore } from '../store/useAppStore'
import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import FilterBar from './FilterBar'
import ResultsGrid from './ResultsGrid'
import StatusBar from './StatusBar'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
  const activeKind = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t?.kind ?? null
  })

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
            <StatusBar />
          </>
        )}
      </div>
    </div>
  )
}
