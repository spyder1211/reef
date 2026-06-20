import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { QueryHistoryEntry } from '../../../shared/types'
import { useT } from '../i18n/useT'
import styles from './HistoryPanel.module.css'

// SQL タブのクエリ履歴を表示する右サイドパネル。
// マウント時（パネルを開くたび）に最新の履歴を取得する。エントリのクリックで
// アクティブ SQL タブのエディタ内容を置き換える。
export default function HistoryPanel(): JSX.Element {
  const { t } = useT()
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([])
  const [filter, setFilter] = useState('')
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setTabSql = useAppStore((s) => s.setTabSql)
  const toggleHistory = useAppStore((s) => s.toggleHistory)

  function reload(): void {
    void window.api.history.list().then((res) => {
      if (res.ok) setEntries(res.data)
    })
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleClear(): Promise<void> {
    if (!window.confirm(t('workspace.historyClear'))) return
    const res = await window.api.history.clear()
    if (res.ok) setEntries([])
  }

  const visible = filter
    ? entries.filter((e) => e.sql.toLowerCase().includes(filter.toLowerCase()))
    : entries

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <input
          className={styles.search}
          placeholder={t('workspace.historySearch')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={styles.iconBtn} onClick={handleClear} title={t('workspace.historyClear')} aria-label={t('workspace.historyClear')}>
          🗑
        </button>
        <button className={styles.iconBtn} onClick={toggleHistory} title={t('common.close')} aria-label={t('common.close')}>
          ×
        </button>
      </div>
      <ul className={styles.list}>
        {visible.map((e) => (
          <li key={e.id}>
            <button
              className={e.ok ? styles.item : styles.itemError}
              title={e.sql}
              onClick={() => activeTabId && setTabSql(activeTabId, e.sql)}
            >
              <span className={styles.sql}>{e.sql}</span>
              <span className={styles.meta}>
                {new Date(e.executedAt).toLocaleString()} ・ {e.durationMs}ms
                {e.ok ? '' : t('workspace.historyFailed')}
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className={styles.empty}>{t('workspace.historyEmpty')}</li>}
      </ul>
    </aside>
  )
}
