import { wrapIndex } from './overlay'

interface ContextMenuKeyEvent {
  key: string
  preventDefault: () => void
  stopPropagation: () => void
}

interface ContextMenuKeyOptions {
  currentIndex: number
  itemCount: number
  focusItem: (index: number) => void
  close: () => void
}

export function handleContextMenuKey(
  e: ContextMenuKeyEvent,
  { currentIndex, itemCount, focusItem, close }: ContextMenuKeyOptions
): boolean {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
    return true
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    e.stopPropagation()
    close()
    return true
  }

  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false

  e.preventDefault()
  e.stopPropagation()
  if (itemCount === 0) return true

  const delta = e.key === 'ArrowDown' ? 1 : -1
  const next = currentIndex === -1 ? 0 : wrapIndex(currentIndex, itemCount, delta)
  focusItem(next)
  return true
}
