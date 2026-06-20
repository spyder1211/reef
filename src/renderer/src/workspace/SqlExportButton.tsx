import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n/useT'
import styles from './ExportMenu.module.css'

// SQL タブの実行結果を CSV 保存するボタン。ExportMenu と同じ一時メッセージ表示を使う。
export default function SqlExportButton(): JSX.Element {
  const { t } = useT()
  const activeTabId = useAppStore((s) => s.activeTabId)
  const exportSqlResultCsv = useAppStore((s) => s.exportSqlResultCsv)
  const disabled = useAppStore((s) => {
    const t = s.tabs.find((tt) => tt.id === s.activeTabId)
    return !(t && t.kind === 'sql' && t.result && t.result.rows.length > 0)
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const run = async (): Promise<void> => {
    if (!activeTabId) return
    setBusy(true)
    try {
      const res = await exportSqlResultCsv(activeTabId)
      if (!res.ok) {
        window.alert(t('workspace.csvSaveError', { message: res.message ?? '' }))
      } else if (res.message) {
        showMessage(res.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      {msg && <span className={styles.msg}>{msg}</span>}
      <button className={styles.btn} disabled={disabled || busy} onClick={() => void run()}>
        {t('workspace.csvSaveBtn')}
      </button>
    </div>
  )
}
