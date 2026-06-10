import { useState, type DragEvent } from 'react'
import { useAppStore } from '../store/useAppStore'
import { TAG_COLORS, TAG_LABELS } from '../lib/tags'
import { computeReorder, type GroupView } from '../lib/grouping'
import ConnectionRow from './ConnectionRow'
import styles from './GroupSection.module.css'

const CONN_MIME = 'application/x-tableplus-conn'
const GROUP_MIME = 'application/x-tableplus-group'

export default function GroupSection({
  view,
  collapsed,
  searching
}: {
  view: GroupView
  collapsed: boolean
  searching: boolean
}): JSX.Element {
  const groups = useAppStore((s) => s.groups)
  const toggleCollapse = useAppStore((s) => s.toggleCollapse)
  const renameGroup = useAppStore((s) => s.renameGroup)
  const deleteGroup = useAppStore((s) => s.deleteGroup)
  const reorderGroups = useAppStore((s) => s.reorderGroups)
  const moveProfileToGroup = useAppStore((s) => s.moveProfileToGroup)

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(view.name)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropActive, setDropActive] = useState(false)

  const expanded = searching || !collapsed
  const targetGroupId = view.isUngrouped ? null : view.id

  function onDragOver(e: DragEvent): void {
    const types = e.dataTransfer.types
    const accepts =
      types.includes(CONN_MIME) || (types.includes(GROUP_MIME) && !view.isUngrouped)
    if (accepts) {
      e.preventDefault()
      setDropActive(true)
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault()
    setDropActive(false)
    const connId = e.dataTransfer.getData(CONN_MIME)
    if (connId) {
      void moveProfileToGroup(connId, targetGroupId)
      return
    }
    const groupId = e.dataTransfer.getData(GROUP_MIME)
    if (groupId && !view.isUngrouped) {
      const ordered = [...groups].sort((a, b) => a.order - b.order).map((g) => g.id)
      const next = computeReorder(ordered, groupId, view.id)
      if (next.join('|') !== ordered.join('|')) void reorderGroups(next)
    }
  }

  function commitRename(): void {
    setRenaming(false)
    const name = draft.trim()
    if (name && name !== view.name) void renameGroup(view.id, name)
    else setDraft(view.name)
  }

  return (
    <div
      className={`${styles.group} ${dropActive ? styles.dropActive : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div
        className={styles.header}
        draggable={!view.isUngrouped && !renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(GROUP_MIME, view.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onContextMenu={(e) => {
          if (view.isUngrouped) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <button
          className={styles.caret}
          onClick={() => toggleCollapse(view.id)}
          disabled={searching}
          title={expanded ? '折り畳む' : '展開する'}
        >
          {expanded ? '▼' : '▶'}
        </button>
        {renaming ? (
          <input
            className={styles.renameInput}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setRenaming(false)
                setDraft(view.name)
              }
            }}
          />
        ) : (
          <span
            className={styles.name}
            onDoubleClick={() => {
              if (!view.isUngrouped) {
                setDraft(view.name)
                setRenaming(true)
              }
            }}
          >
            {view.name}
          </span>
        )}
        <span className={styles.count}>{view.count}</span>
      </div>

      {expanded &&
        view.subgroups.map((sg) => (
          <div key={sg.tag} className={styles.sub}>
            <div className={styles.subHead}>
              <span className={styles.dot} style={{ background: TAG_COLORS[sg.tag] }} />
              {TAG_LABELS[sg.tag] || 'その他'}
            </div>
            {sg.profiles.map((p) => (
              <ConnectionRow key={p.id} profile={p} />
            ))}
          </div>
        ))}

      {menu && (
        <>
          <div className={styles.menuBackdrop} onMouseDown={() => setMenu(null)} />
          <div
            className={styles.menu}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className={styles.menuItem}
              onClick={() => {
                setMenu(null)
                if (
                  window.confirm(
                    `グループ「${view.name}」を削除します。中の接続は未分類へ移動します。よろしいですか？`
                  )
                ) {
                  void deleteGroup(view.id)
                }
              }}
            >
              グループを削除
            </button>
          </div>
        </>
      )}
    </div>
  )
}
