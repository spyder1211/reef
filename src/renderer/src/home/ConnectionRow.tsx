import type { ConnectionProfile } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import Avatar from '../components/Avatar'
import Tag from '../components/Tag'
import styles from './ConnectionRow.module.css'

export default function ConnectionRow({ profile }: { profile: ConnectionProfile }): JSX.Element {
  const connect = useAppStore((s) => s.connect)
  const openForm = useAppStore((s) => s.openForm)
  const deleteProfile = useAppStore((s) => s.deleteProfile)
  const sub = `${profile.host} : ${profile.database ?? profile.user}`

  return (
    <div className={styles.row} onDoubleClick={() => void connect(profile)}>
      <Avatar name={profile.name} tag={profile.tag} />
      <div className={styles.meta}>
        <div className={styles.nameLine}>
          <span className={styles.name}>{profile.name}</span>
          <Tag tag={profile.tag} />
        </div>
        <div className={styles.sub}>{sub}</div>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            openForm(profile.id)
          }}
        >
          編集
        </button>
        <button
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            void deleteProfile(profile.id)
          }}
        >
          削除
        </button>
        <button
          className={styles.connect}
          onClick={(e) => {
            e.stopPropagation()
            void connect(profile)
          }}
        >
          接続
        </button>
      </div>
    </div>
  )
}
