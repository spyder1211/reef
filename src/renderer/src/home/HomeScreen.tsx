import { useAppStore } from '../store/useAppStore'
import AppRail from './AppRail'
import styles from './HomeScreen.module.css'

export default function HomeScreen(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const openForm = useAppStore((s) => s.openForm)

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
        {/* Task 15 で <ConnectionList /> に置き換える */}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  )
}
