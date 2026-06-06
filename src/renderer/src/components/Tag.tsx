import type { ConnectionTag } from '../../../shared/types'
import { TAG_COLORS, TAG_LABELS } from '../lib/tags'
import styles from './Tag.module.css'

export default function Tag({
  tag,
  light = false
}: {
  tag: ConnectionTag
  light?: boolean
}): JSX.Element | null {
  if (tag === 'none') return null
  return (
    <span className={styles.tag} style={{ color: light ? 'rgba(255,255,255,0.85)' : TAG_COLORS[tag] }}>
      {TAG_LABELS[tag]}
    </span>
  )
}
