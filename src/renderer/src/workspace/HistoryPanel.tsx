import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { QueryHistoryEntry } from '../../../shared/types'
import styles from './HistoryPanel.module.css'

// SQL タブのクエリ履歴を表示する右サイドパネル。
// マウント時（パネルを開くたび）に最新の履歴を取得する。エントリのクリックで
// アクティブ SQL タブのエディタ内容を置き換える。
export default function HistoryPanel(): JSX.Element {
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
    if (!window.confirm('クエリ履歴をすべて削除しますか？')) return
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
          placeholder="履歴を検索"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={styles.iconBtn} onClick={handleClear} title="履歴を全削除" aria-label="履歴を全削除">
          🗑
        </button>
        <button className={styles.iconBtn} onClick={toggleHistory} title="閉じる" aria-label="閉じる">
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
                {e.ok ? '' : ' ・ 失敗'}
              </span>
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className={styles.empty}>履歴はありません</li>}
      </ul>
    </aside>
  )
}
