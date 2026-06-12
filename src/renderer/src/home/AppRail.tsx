import { useAppStore } from '../store/useAppStore'
import appIcon from '../assets/app-icon.png'
import styles from './AppRail.module.css'

export default function AppRail(): JSX.Element {
  const openForm = useAppStore((s) => s.openForm)
  return (
    <div className={styles.rail}>
      <img className={styles.logo} src={appIcon} alt="Table++" width={64} height={64} />
      <div className={styles.name}>Table++</div>
      <div className={styles.version}>Version {__APP_VERSION__}</div>
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
