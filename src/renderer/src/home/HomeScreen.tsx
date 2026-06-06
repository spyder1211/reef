import { useAppStore } from '../store/useAppStore'
import AppRail from './AppRail'
import ConnectionList from './ConnectionList'
import ConnectionFormModal from './ConnectionFormModal'
import styles from './HomeScreen.module.css'

export default function HomeScreen(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const openForm = useAppStore((s) => s.openForm)
  const formOpen = useAppStore((s) => s.formOpen)

  return (
    <div className={styles.home}>
      <AppRail />
      <div className={styles.main}>
        <div className={styles.top}>
          <button className={styles.plus} onClick={() => openForm()} title="新規接続">
            ＋
          </button>
          <input
            className={styles.search}
            placeholder="接続を検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ConnectionList />
      </div>
      {formOpen && <ConnectionFormModal />}
    </div>
  )
}
