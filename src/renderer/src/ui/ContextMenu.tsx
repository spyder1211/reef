import { useLayoutEffect, useRef, useState } from 'react'
import { handleContextMenuKey } from '../lib/contextMenuKeyboard'
import { clampMenuPosition } from '../lib/menuPosition'
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
    const next = clampMenuPosition(
      anchor,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight }
    )
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next))
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
    const list = items()
    handleContextMenuKey(e, {
      currentIndex: list.indexOf(document.activeElement as HTMLElement),
      itemCount: list.length,
      focusItem: (index) => list[index]?.focus(),
      close: onClose
    })
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
