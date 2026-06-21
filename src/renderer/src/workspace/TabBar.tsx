import { useT } from '../i18n/useT'
import { useAppStore } from '../store/useAppStore'
import styles from './TabBar.module.css'

export default function TabBar(): JSX.Element {
  const { t } = useT()
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const addTab = useAppStore((s) => s.addTab)

  return (
    <div className={styles.tabbar}>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          tabIndex={0}
          className={t.id === activeTabId ? styles.tabActive : styles.tab}
          onClick={() => setActiveTab(t.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setActiveTab(t.id)
          }}
        >
          <span className={styles.icon}>{t.kind === 'table' ? '▦' : '⚡'}</span>
          <span className={styles.title}>{t.kind === 'table' ? t.tableName : t.title}</span>
          <button
            type="button"
            className={styles.close}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.add}
        onClick={() => addTab()}
        title={t('workspace.newQueryTab')}
      >
        ＋
      </button>
    </div>
  )
}
