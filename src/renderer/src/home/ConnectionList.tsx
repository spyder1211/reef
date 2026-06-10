import { useAppStore } from '../store/useAppStore'
import { buildGroupedView } from '../lib/grouping'
import GroupSection from './GroupSection'
import styles from './ConnectionList.module.css'

export default function ConnectionList(): JSX.Element {
  const profiles = useAppStore((s) => s.profiles)
  const groups = useAppStore((s) => s.groups)
  const search = useAppStore((s) => s.search)
  const collapsed = useAppStore((s) => s.collapsed)
  const views = buildGroupedView(profiles, groups, search)
  const searching = search.trim().length > 0

  if (profiles.length === 0) {
    return <div className={styles.empty}>＋ から最初の接続を作成してください</div>
  }
  if (views.length === 0) {
    return <div className={styles.empty}>「{search}」に一致する接続はありません</div>
  }
  return (
    <div className={styles.list}>
      {views.map((v) => (
        <GroupSection key={v.id} view={v} collapsed={!!collapsed[v.id]} searching={searching} />
      ))}
    </div>
  )
}
