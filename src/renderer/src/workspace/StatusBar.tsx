import { useAppStore } from '../store/useAppStore'
import { TAG_COLORS } from '../lib/tags'
import styles from './StatusBar.module.css'

export default function StatusBar(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const profile = useAppStore((s) => s.activeProfile)
  const r = tab?.result

  return (
    <div className={styles.status}>
      <span>{r ? `${r.rowCount} 行 · ${r.durationMs} ms` : '—'}</span>
      <span className={styles.right}>
        <span className={styles.dot} style={{ background: TAG_COLORS[profile?.tag ?? 'none'] }} />
        {profile?.name}
      </span>
    </div>
  )
}
