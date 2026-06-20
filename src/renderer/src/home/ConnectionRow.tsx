import { useState } from 'react'
import type { ConnectionProfile } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import Avatar from '../components/Avatar'
import Tag from '../components/Tag'
import styles from './ConnectionRow.module.css'

export default function ConnectionRow({ profile }: { profile: ConnectionProfile }): JSX.Element {
  const connect = useAppStore((s) => s.connect)
  const openForm = useAppStore((s) => s.openForm)
  const deleteProfile = useAppStore((s) => s.deleteProfile)
  const duplicateProfile = useAppStore((s) => s.duplicateProfile)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const sub = `${profile.host} : ${profile.database ?? profile.user}`

  return (
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
      <div className={styles.actions} onDoubleClick={(e) => e.stopPropagation()}>
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

      {menu && (
        <>
          <div className={styles.menuBackdrop} onMouseDown={() => setMenu(null)} />
          <div
            className={styles.menu}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              className={styles.menuItem}
              onClick={() => {
                setMenu(null)
                void duplicateProfile(profile.id)
              }}
            >
              複製
            </button>
            <button
              className={styles.menuItem}
              onClick={() => {
                setMenu(null)
                openForm(profile.id)
              }}
            >
              編集
            </button>
            <div className={styles.menuSep} />
            <button
              className={`${styles.menuItem} ${styles.danger}`}
              onClick={() => {
                setMenu(null)
                void deleteProfile(profile.id)
              }}
            >
              削除
            </button>
          </div>
        </>
      )}
    </div>
  )
}
