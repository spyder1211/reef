import { useT } from '../i18n/useT'
import { buildGroupedView } from '../lib/grouping'
import { useAppStore } from '../store/useAppStore'
import styles from './ConnectionList.module.css'
import GroupSection from './GroupSection'

export default function ConnectionList(): JSX.Element {
  const { t } = useT()
  const profiles = useAppStore((s) => s.profiles)
  const groups = useAppStore((s) => s.groups)
  const search = useAppStore((s) => s.search)
  const collapsed = useAppStore((s) => s.collapsed)
  const views = buildGroupedView(profiles, groups, search)
  const searching = search.trim().length > 0

  if (profiles.length === 0) {
    return <div className={styles.empty}>{t('home.emptyHint')}</div>
  }
  if (views.length === 0) {
    return <div className={styles.empty}>{t('home.noResults', { search })}</div>
  }
  return (
    <div className={styles.list}>
      {views.map((v) => (
        <GroupSection key={v.id} view={v} collapsed={!!collapsed[v.id]} searching={searching} />
      ))}
    </div>
  )
}
