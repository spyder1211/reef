import Sidebar from './Sidebar'
import TabBar from './TabBar'
import QueryEditor from './QueryEditor'
import ResultsGrid from './ResultsGrid'
import StatusBar from './StatusBar'
import styles from './WorkspaceShell.module.css'

export default function WorkspaceShell(): JSX.Element {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.mainCol}>
        <TabBar />
        <QueryEditor />
        <ResultsGrid />
        <StatusBar />
      </div>
    </div>
  )
}
