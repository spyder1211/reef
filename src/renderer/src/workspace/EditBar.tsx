import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import styles from './EditBar.module.css'

export default function EditBar(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const commitEdits = useAppStore((s) => s.commitEdits)
  const discardEdits = useAppStore((s) => s.discardEdits)

  const updateCount = tab
    ? Object.values(tab.edits).reduce((n, e) => n + Object.keys(e.values).length, 0)
    : 0
  const insertCount = tab ? tab.inserts.length : 0
  const deleteCount = tab ? Object.keys(tab.deletes).length : 0
  const hasChanges = updateCount > 0 || insertCount > 0 || deleteCount > 0
  const tabId = tab?.id

  // ⌘S / Ctrl+S でコミット（変更がある間だけ購読）。running 中の二重実行は commitEdits 側で防ぐ。
  useEffect(() => {
    if (!tabId || !hasChanges) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void commitEdits(tabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabId, hasChanges, commitEdits])

  if (!tab || !hasChanges) return null

  // 変更の内訳を組み立てる（0件の種別は省略）
  const parts: string[] = []
  if (updateCount > 0) parts.push(`UPDATE ${updateCount} 件`)
  if (insertCount > 0) parts.push(`INSERT ${insertCount} 行`)
  if (deleteCount > 0) parts.push(`DELETE ${deleteCount} 行`)
  const summary = parts.join(' / ')

  return (
    <div className={styles.bar}>
      <span className={styles.count}>● 未コミットの変更: {summary}</span>
      {tab.editError && (
        <span className={styles.err}>
          {tab.editError.code}: {tab.editError.message}
        </span>
      )}
      <span className={styles.spacer} />
      <button disabled={tab.running} onClick={() => discardEdits(tab.id)}>
        破棄
      </button>
      <button
        className={styles.commit}
        disabled={tab.running}
        onClick={() => void commitEdits(tab.id)}
      >
        コミット ⌘S
      </button>
    </div>
  )
}
