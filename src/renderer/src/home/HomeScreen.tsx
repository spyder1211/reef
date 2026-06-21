import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n/useT'
import AppRail from './AppRail'
import ConnectionList from './ConnectionList'
import ConnectionFormModal from './ConnectionFormModal'
import styles from './HomeScreen.module.css'

export default function HomeScreen(): JSX.Element {
  const { t } = useT()
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
          <button
            className={styles.plus}
            onClick={() => openForm()}
            title={t('home.newConnection')}
          >
            ＋
          </button>
          <button
            className={styles.plus}
            title={t('home.newGroupTitle')}
            onClick={() => setGroupDraft('')}
          >
            🗂
          </button>
          {groupDraft !== null && (
            <input
              className={styles.groupInput}
              placeholder={t('home.groupNamePlaceholder')}
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
            placeholder={t('home.searchConnections')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ConnectionList />
        {connectError && (
          <div className={styles.connError}>
            {t('home.connectError', { code: connectError.code, message: connectError.message })}
          </div>
        )}
      </div>
      {formOpen && <ConnectionFormModal />}
    </div>
  )
}
