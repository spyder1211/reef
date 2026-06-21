import { useAppStore } from '../store/useAppStore'
import { TAG_COLORS } from '../lib/tags'
import { useT } from '../i18n/useT'
import styles from './StatusBar.module.css'

export default function StatusBar(): JSX.Element {
  const { t } = useT()
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const profile = useAppStore((s) => s.activeProfile)
  const r = tab?.result

  return (
    <div className={styles.status}>
      <span>
        {r
          ? t('workspace.statusRow', { count: String(r.rowCount), ms: String(r.durationMs) })
          : '—'}
      </span>
      <span className={styles.right}>
        <span className={styles.dot} style={{ background: TAG_COLORS[profile?.tag ?? 'none'] }} />
        {profile?.name}
      </span>
    </div>
  )
}
