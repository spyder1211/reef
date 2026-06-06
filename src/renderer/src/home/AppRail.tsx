import { useAppStore } from '../store/useAppStore'
import styles from './AppRail.module.css'

export default function AppRail(): JSX.Element {
  const openForm = useAppStore((s) => s.openForm)
  return (
    <div className={styles.rail}>
      <div className={styles.logo}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
          <ellipse cx="12" cy="5" rx="8" ry="3" fill="#fff" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" stroke="#fff" strokeWidth="1.6" fill="none" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" stroke="#fff" strokeWidth="1.6" fill="none" />
        </svg>
      </div>
      <div className={styles.name}>MySQL Client</div>
      <div className={styles.version}>Version 0.1.0</div>
      <div className={styles.spacer} />
      <button className={styles.railBtn} onClick={() => openForm()}>
        ＋ 新規接続
      </button>
      <button className={styles.railBtn} disabled title="今後対応">
        ⚙ 設定
      </button>
    </div>
  )
}
