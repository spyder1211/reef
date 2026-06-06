import { useAppStore } from '../store/useAppStore'
import { filterProfiles } from '../store/helpers'
import ConnectionRow from './ConnectionRow'
import styles from './ConnectionList.module.css'

export default function ConnectionList(): JSX.Element {
  const profiles = useAppStore((s) => s.profiles)
  const search = useAppStore((s) => s.search)
  const shown = filterProfiles(profiles, search)

  if (profiles.length === 0) {
    return <div className={styles.empty}>＋ から最初の接続を作成してください</div>
  }
  if (shown.length === 0) {
    return <div className={styles.empty}>「{search}」に一致する接続はありません</div>
  }
  return (
    <div className={styles.list}>
      {shown.map((p) => (
        <ConnectionRow key={p.id} profile={p} />
      ))}
    </div>
  )
}
