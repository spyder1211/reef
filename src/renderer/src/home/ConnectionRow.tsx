import { useState } from 'react'
import type { ConnectionProfile } from '../../../shared/types'
import Avatar from '../components/Avatar'
import Tag from '../components/Tag'
import { useT } from '../i18n/useT'
import { useAppStore } from '../store/useAppStore'
import styles from './ConnectionRow.module.css'

export default function ConnectionRow({ profile }: { profile: ConnectionProfile }): JSX.Element {
  const { t } = useT()
  const connect = useAppStore((s) => s.connect)
  const openForm = useAppStore((s) => s.openForm)
  const deleteProfile = useAppStore((s) => s.deleteProfile)
  const duplicateProfile = useAppStore((s) => s.duplicateProfile)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const sub = `${profile.host} : ${profile.database ?? profile.user}`

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: draggable connection row with double-click and context menu
    <div
      className={styles.row}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-reef-conn', profile.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDoubleClick={() => void connect(profile)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <Avatar name={profile.name} tag={profile.tag} />
      <div className={styles.meta}>
        <div className={styles.nameLine}>
          <span className={styles.name}>{profile.name}</span>
          <Tag tag={profile.tag} />
        </div>
        <div className={styles.sub}>{sub}</div>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: actions container stops double-click propagation to parent row */}
      <div className={styles.actions} onDoubleClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            openForm(profile.id)
          }}
        >
          {t('common.edit')}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation()
            void deleteProfile(profile.id)
          }}
        >
          {t('common.delete')}
        </button>
        <button
          type="button"
          className={styles.connect}
          onClick={(e) => {
            e.stopPropagation()
            void connect(profile)
          }}
        >
          {t('common.connect')}
        </button>
      </div>

      {menu && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes menu on mousedown */}
          <div className={styles.menuBackdrop} onMouseDown={() => setMenu(null)} />
          <div
            role="menu"
            className={styles.menu}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenu(null)
                void duplicateProfile(profile.id)
              }}
            >
              {t('common.duplicate')}
            </button>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => {
                setMenu(null)
                openForm(profile.id)
              }}
            >
              {t('common.edit')}
            </button>
            <div className={styles.menuSep} />
            <button
              type="button"
              className={`${styles.menuItem} ${styles.danger}`}
              onClick={() => {
                setMenu(null)
                void deleteProfile(profile.id)
              }}
            >
              {t('common.delete')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
