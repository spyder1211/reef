import { useLayoutEffect, useRef, useState } from 'react'
import { clampMenuPosition } from '../lib/menuPosition'
import { wrapIndex } from '../lib/overlay'
import styles from './ContextMenu.module.css'

interface ContextMenuProps {
  open: boolean
  anchor: { x: number; y: number }
  onClose: () => void
  ariaLabel?: string
  className?: string
  children: React.ReactNode
}

export default function ContextMenu({
  open,
  anchor,
  onClose,
  ariaLabel,
  className,
  children
}: ContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.y, left: anchor.x })

  // 実寸を測ってビューポート内にクランプ/フリップ（ペイント前）。
  useLayoutEffect(() => {
    if (!open) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos(
      clampMenuPosition(
        anchor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    )
  }, [open, anchor])

  // 開いたら先頭の有効項目へフォーカス。
  useLayoutEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open])

  if (!open) return null

  const items = (): HTMLElement[] =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    )

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = items()
      if (list.length === 0) return
      const cur = list.indexOf(document.activeElement as HTMLElement)
      const next = cur === -1 ? 0 : wrapIndex(cur, list.length, e.key === 'ArrowDown' ? 1 : -1)
      e.preventDefault()
      list[next].focus()
    }
    // Enter/Space はネイティブ button が既定で発火するため明示不要。
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes menu on mousedown */}
      <div className={styles.backdrop} onMouseDown={onClose} />
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={className ? `${styles.menu} ${className}` : styles.menu}
        style={{ top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </>
  )
}
