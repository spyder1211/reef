import { describe, expect, it, vi } from 'vitest'
import { handleContextMenuKey } from './contextMenuKeyboard'

function event(key: string): {
  event: { key: string; preventDefault: () => void; stopPropagation: () => void }
  preventDefault: ReturnType<typeof vi.fn>
  stopPropagation: ReturnType<typeof vi.fn>
} {
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  return {
    event: { key, preventDefault, stopPropagation },
    preventDefault,
    stopPropagation
  }
}

describe('handleContextMenuKey', () => {
  it('ArrowDown moves focus and does not bubble to parent overlays', () => {
    const e = event('ArrowDown')
    const focus = vi.fn()

    handleContextMenuKey(e.event, {
      currentIndex: 0,
      itemCount: 3,
      focusItem: focus,
      close: vi.fn()
    })

    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith(1)
  })

  it('ArrowUp wraps focus and does not bubble to parent overlays', () => {
    const e = event('ArrowUp')
    const focus = vi.fn()

    handleContextMenuKey(e.event, {
      currentIndex: 0,
      itemCount: 3,
      focusItem: focus,
      close: vi.fn()
    })

    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith(2)
  })

  it('Tab closes the menu without moving focus behind an open backdrop', () => {
    const e = event('Tab')
    const close = vi.fn()

    handleContextMenuKey(e.event, { currentIndex: 0, itemCount: 3, focusItem: vi.fn(), close })

    expect(e.preventDefault).toHaveBeenCalledTimes(1)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the menu and does not bubble', () => {
    const e = event('Escape')
    const close = vi.fn()

    handleContextMenuKey(e.event, { currentIndex: 0, itemCount: 3, focusItem: vi.fn(), close })

    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
})
