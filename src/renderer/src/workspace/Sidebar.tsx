import { useAppStore } from '../store/useAppStore'
import Avatar from '../components/Avatar'
import TableList from './TableList'
import styles from './Sidebar.module.css'

export default function Sidebar(): JSX.Element {
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
      <button className={styles.back} onClick={() => void disconnect()}>
        ← 接続一覧
      </button>
    </div>
  )
}
