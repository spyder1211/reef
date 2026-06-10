import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import AppRail from './AppRail'
import ConnectionList from './ConnectionList'
import ConnectionFormModal from './ConnectionFormModal'
import styles from './HomeScreen.module.css'

export default function HomeScreen(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const openForm = useAppStore((s) => s.openForm)
  const createGroup = useAppStore((s) => s.createGroup)
  const formOpen = useAppStore((s) => s.formOpen)
  const connectError = useAppStore((s) => s.connectError)
  const [groupDraft, setGroupDraft] = useState<string | null>(null) // null=非作成中

  function submitGroup(): void {
    const name = (groupDraft ?? '').trim()
    if (name) void createGroup(name)
    setGroupDraft(null)
  }

  return (
    <div className={styles.home}>
      <AppRail />
      <div className={styles.main}>
        <div className={styles.top}>
          <button className={styles.plus} onClick={() => openForm()} title="新規接続">
            ＋
          </button>
          <button
            className={styles.plus}
            title="新規グループ"
            onClick={() => setGroupDraft('')}
          >
            🗂
          </button>
          {groupDraft !== null && (
            <input
              className={styles.groupInput}
              placeholder="グループ名を入力…"
              value={groupDraft}
              autoFocus
              onChange={(e) => setGroupDraft(e.target.value)}
              onBlur={() => setGroupDraft(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitGroup()
                if (e.key === 'Escape') setGroupDraft(null)
              }}
            />
          )}
          <input
            className={styles.search}
            placeholder="接続を検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ConnectionList />
        {connectError && (
          <div className={styles.connError}>
            接続失敗 — <b>{connectError.code}</b>: {connectError.message}
          </div>
        )}
      </div>
      {formOpen && <ConnectionFormModal />}
    </div>
  )
}
