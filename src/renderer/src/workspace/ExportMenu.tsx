import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n/useT'
import styles from './ExportMenu.module.css'

type Scope = 'page' | 'all'
type Target = 'file' | 'clipboard'

// テーブルタブのレコードを CSV としてエクスポートするメニュー。
// 範囲（現在ページ/全件）× 受け渡し（保存/コピー）の 4 通りをドロップダウンで提供する。
export default function ExportMenu({ disabled }: { disabled: boolean }): JSX.Element {
  const { t } = useT()
  const activeTabId = useAppStore((s) => s.activeTabId)
  const exportCsv = useAppStore((s) => s.exportCsv)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 外側クリックで閉じる（ResultsGrid の ctxMenu と同じ mousedown 方式）。
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // 一時メッセージのタイマをアンマウント時に片付ける。
  useEffect(() => {
    return () => {
      if (msgTimer.current) clearTimeout(msgTimer.current)
    }
  }, [])

  const showMessage = (text: string): void => {
    setMsg(text)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(''), 3000)
  }

  const run = async (scope: Scope, target: Target): Promise<void> => {
    if (!activeTabId) return
    setOpen(false)
    setBusy(true)
    try {
      const res = await exportCsv(activeTabId, { scope, target })
      if (!res.ok) {
        window.alert(t('workspace.exportError', { message: res.message ?? '' }))
      } else if (res.message) {
        showMessage(res.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // wrap 内の mousedown を止め、ボタン/項目クリックで即座に閉じないようにする。
  return (
    <div className={styles.wrap} onMouseDown={(e) => e.stopPropagation()}>
      {msg && <span className={styles.msg}>{msg}</span>}
      <button className={styles.btn} disabled={disabled || busy} onClick={() => setOpen((v) => !v)}>
        {t('workspace.exportBtn')}
      </button>
      {open && (
        <div className={styles.menu}>
          <div className={styles.item} onClick={() => void run('page', 'file')}>
            {t('workspace.exportPageFile')}
          </div>
          <div className={styles.item} onClick={() => void run('page', 'clipboard')}>
            {t('workspace.exportPageClip')}
          </div>
          <div className={styles.sep} />
          <div className={styles.item} onClick={() => void run('all', 'file')}>
            {t('workspace.exportAllFile')}
          </div>
          <div className={styles.item} onClick={() => void run('all', 'clipboard')}>
            {t('workspace.exportAllClip')}
          </div>
        </div>
      )}
    </div>
  )
}
