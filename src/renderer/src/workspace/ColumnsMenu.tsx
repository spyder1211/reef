import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../i18n/useT'
import { clampMenuPosition } from '../lib/menuPosition'
import styles from './ColumnsMenu.module.css'

interface ColumnsMenuProps {
  anchor: { x: number; y: number }
  columns: string[]
  hiddenColumns: string[]
  pinnedColumns: string[]
  onToggleHidden: (column: string) => void
  onTogglePinned: (column: string) => void
  onShowAll: () => void
  onClose: () => void
}

export default function ColumnsMenu({
  anchor,
  columns,
  hiddenColumns,
  pinnedColumns,
  onToggleHidden,
  onTogglePinned,
  onShowAll,
  onClose
}: ColumnsMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: anchor.y, left: anchor.x })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const next = clampMenuPosition(
      anchor,
      { width: r.width, height: r.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setPos((p) => (p.top === next.top && p.left === next.left ? p : next))
  }, [anchor])
  const { t } = useT()
  // Escape キーで閉じる（バックドロップクリックと対称）
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])
  const visibleCount = columns.filter((c) => !hiddenColumns.includes(c)).length
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 外側クリックで閉じるバックドロップ */}
      <div className={styles.backdrop} onMouseDown={onClose} />
      <div
        ref={ref}
        className={styles.panel}
        style={{ top: pos.top, left: pos.left }}
        role="dialog"
        aria-modal="true"
        aria-label={t('workspace.columns')}
      >
        {columns.map((name) => {
          const visible = !hiddenColumns.includes(name)
          const isPinned = pinnedColumns.includes(name)
          return (
            <div key={name} className={styles.row}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={visible && visibleCount <= 1}
                  onChange={() => onToggleHidden(name)}
                />
                <span className={styles.colName}>{name}</span>
              </label>
              <button
                type="button"
                className={isPinned ? styles.pinOn : styles.pin}
                onClick={() => onTogglePinned(name)}
                title={isPinned ? t('workspace.colUnpin') : t('workspace.colPin')}
                aria-pressed={isPinned}
                aria-label={isPinned ? t('workspace.colUnpin') : t('workspace.colPin')}
              >
                📌
              </button>
            </div>
          )
        })}
        <button type="button" className={styles.showAll} onClick={onShowAll}>
          {t('workspace.colShowAll')}
        </button>
      </div>
    </>
  )
}
