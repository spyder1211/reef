import { type MouseEvent as ReactMouseEvent, useRef, useState } from 'react'
import { useT } from '../i18n/useT'
import ResultsGrid from './ResultsGrid'
import styles from './SplitGrids.module.css'

// 同じアクティブタブを左右2枚の ResultsGrid で表示する。両者とも store の activeTab を読むため
// 内容は同一で、スクロール位置だけが各 DOM で独立する（フィルタ/ページ/ソート/選択は共有）。
// 中央の仕切りをドラッグして左ペインの幅（%）を調整できる。
export default function SplitGrids(): JSX.Element {
  const { t } = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(50)

  function startDrag(e: ReactMouseEvent): void {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const onMove = (ev: globalThis.MouseEvent): void => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0) return
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(85, Math.max(15, pct)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={containerRef} className={styles.row}>
      <div className={styles.pane} style={{ flex: `0 0 ${leftPct}%` }}>
        <ResultsGrid />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: resize divider handles only pointer events */}
      <div className={styles.divider} onMouseDown={startDrag} title={t('workspace.splitDivider')} />
      <div className={styles.pane} style={{ flex: 1 }}>
        <ResultsGrid />
      </div>
    </div>
  )
}
