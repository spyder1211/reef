import Avatar from '../components/Avatar'
import { useT } from '../i18n/useT'
import { useAppStore } from '../store/useAppStore'
import styles from './Sidebar.module.css'
import TableList from './TableList'

export default function Sidebar(): JSX.Element {
  const { t } = useT()
  const profile = useAppStore((s) => s.activeProfile)
  const disconnect = useAppStore((s) => s.disconnect)

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <Avatar name={profile?.name ?? '?'} tag={profile?.tag ?? 'none'} size={28} />
        <div className={styles.meta}>
          <div className={styles.name}>{profile?.name ?? ''}</div>
          <div className={styles.sub}>
            {profile?.host} : {profile?.database ?? profile?.user}
          </div>
        </div>
      </div>
      <TableList />
      <button type="button" className={styles.back} onClick={() => void disconnect()}>
        {t('workspace.backToList')}
      </button>
    </div>
  )
}
