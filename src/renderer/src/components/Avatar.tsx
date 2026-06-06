import type { ConnectionTag } from '../../../shared/types'
import { TAG_COLORS, initials } from '../lib/tags'
import styles from './Avatar.module.css'

export default function Avatar({
  name,
  tag,
  size = 32
}: {
  name: string
  tag: ConnectionTag
  size?: number
}): JSX.Element {
  return (
    <div
      className={styles.avatar}
      style={{ width: size, height: size, background: TAG_COLORS[tag], fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  )
}
