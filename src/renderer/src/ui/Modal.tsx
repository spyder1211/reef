import { useEffect, useRef } from 'react'
import { wrapIndex } from '../lib/overlay'
import styles from './Modal.module.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  open: boolean
  onClose: () => void
  labelledBy?: string
  ariaLabel?: string
  dismissable?: boolean
  initialFocusRef?: React.RefObject<HTMLElement>
  className?: string
  children: React.ReactNode
}

export default function Modal({
  open,
  onClose,
  labelledBy,
  ariaLabel,
  dismissable = true,
  initialFocusRef,
  className,
  children
}: ModalProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)

  // 初期フォーカス＋フォーカス復帰。open 遷移基準（マウント/アンマウントに依らない）。
  useEffect(() => {
    if (!open) return
    const prevFocused = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const target =
      initialFocusRef?.current ?? container?.querySelector<HTMLElement>(FOCUSABLE) ?? container
    target?.focus()
    return () => {
      if (prevFocused && document.contains(prevFocused)) prevFocused.focus()
    }
  }, [open, initialFocusRef])

  if (!open) return null

  const focusables = (): HTMLElement[] => {
    const c = containerRef.current
    if (!c) return []
    return Array.from(c.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    )
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Tab') {
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const cur = items.indexOf(document.activeElement as HTMLElement)
      const next = cur === -1 ? (e.shiftKey ? items.length - 1 : 0) : wrapIndex(cur, items.length, e.shiftKey ? -1 : 1)
      e.preventDefault()
      items[next].focus()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes on click when dismissable
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={dismissable ? onClose : undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dialog container manages keyboard focus */}
      <div
        ref={containerRef}
        className={className ? `${styles.container} ${className}` : styles.container}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
