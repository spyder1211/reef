import { useState } from 'react'
import type { ConnectionProfile } from '../../../shared/types'
import Avatar from '../components/Avatar'
import Tag from '../components/Tag'
import { useT } from '../i18n/useT'
import { useAppStore } from '../store/useAppStore'
import ContextMenu from '../ui/ContextMenu'
import styles from './ConnectionRow.module.css'

export default function ConnectionRow({ profile }: { profile: ConnectionProfile }): JSX.Element {
  const { t } = useT()
  const connect = useAppStore((s) => s.connect)
  const status = useAppStore((s) => s.status)
  const connecting = status === 'connecting'
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
      onDoubleClick={() => {
        if (!connecting) void connect(profile)
      }}
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
          disabled={connecting}
          onClick={(e) => {
            e.stopPropagation()
            if (!connecting) void connect(profile)
          }}
        >
          {t('common.connect')}
        </button>
      </div>

      {menu && (
        <ContextMenu
          open
          anchor={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
          className={styles.menu}
        >
          <button
            type="button"
            role="menuitem"
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
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setMenu(null)
              openForm(profile.id)
            }}
          >
            {t('common.edit')}
          </button>
          {/* biome-ignore lint/a11y/useFocusableInteractive: static menu separator does not need focus */}
          {/* biome-ignore lint/a11y/useSemanticElements: div with CSS class matches existing separator styling */}
          {/* biome-ignore lint/a11y/useAriaPropsForRole: static separator in menu does not require aria-valuenow */}
          <div className={styles.menuSep} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.danger}`}
            onClick={() => {
              setMenu(null)
              void deleteProfile(profile.id)
            }}
          >
            {t('common.delete')}
          </button>
        </ContextMenu>
      )}
    </div>
  )
}
