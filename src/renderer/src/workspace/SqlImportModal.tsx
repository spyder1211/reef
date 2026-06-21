import { useEffect, useState } from 'react'
import type { ImportProgress, ImportSummary, SqlImportRequest } from '../../../shared/types'
import { useT } from '../i18n/useT'
import styles from './SqlImportModal.module.css'
import { isCancelled } from '../store/helpers'

type Phase = 'closed' | 'confirm' | 'running' | 'result'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function SqlImportModal(): JSX.Element | null {
  const { t } = useT()
  const [phase, setPhase] = useState<Phase>('closed')
  const [req, setReq] = useState<SqlImportRequest | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    const offReq = window.api.sqlImport.onRequest((r) => {
      setReq(r)
      setProgress(null)
      setSummary(null)
      setFatal(null)
      setPhase('confirm')
    })
    const offProg = window.api.sqlImport.onProgress((p) => setProgress(p))
    return () => {
      offReq()
      offProg()
    }
  }, [])

  if (phase === 'closed' || !req) return null

  const close = (): void => setPhase('closed')

  async function handleRun(): Promise<void> {
    setPhase('running')
    setProgress({ executedCount: 0, bytesRead: 0, totalBytes: req!.totalBytes })
    const res = await window.api.sqlImport.start()
    if (isCancelled(res)) {
      // 本番ガードでキャンセル: エラー表示せず確認画面へ戻す。
      setProgress(null)
      setPhase('confirm')
      return
    }
    if (res.ok) setSummary(res.data)
    else setFatal(`${res.error.code}: ${res.error.message}`)
    setPhase('result')
  }

  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesRead / progress.totalBytes) * 100))
      : 0

  return (
    <div className={styles.backdrop} onClick={phase === 'running' ? undefined : close}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>{t('workspace.importTitle')}</div>

        {phase === 'confirm' && (
          <>
            <div className={styles.row}>
              <span className={styles.k}>{t('workspace.importDbLabel')}</span>
              <b>{req.dbName || t('workspace.importNoDb')}</b>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>{t('workspace.importFileLabel')}</span>
              <span>{req.fileName}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>{t('workspace.importSizeLabel')}</span>
              <span>{formatBytes(req.totalBytes)}</span>
            </div>
            <div className={styles.warn}>{t('workspace.importWarn')}</div>
            <div className={styles.actions}>
              <button className={styles.btn} onClick={close}>
                {t('common.cancel')}
              </button>
              <button className={styles.btnDanger} onClick={() => void handleRun()}>
                {t('workspace.importRun')}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && progress && (
          <>
            <div className={styles.bar}>
              <div className={styles.barFill} style={{ width: `${pct}%` }} />
            </div>
            <div className={styles.row}>
              <span className={styles.k}>{t('workspace.importProgressLabel')}</span>
              <span>
                {t('workspace.importByteProgress', {
                  pct,
                  read: formatBytes(progress.bytesRead),
                  total: formatBytes(progress.totalBytes)
                })}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>{t('workspace.importExecutedLabel')}</span>
              <span>
                {t('workspace.importStatements', { count: String(progress.executedCount) })}
              </span>
            </div>
            {progress.currentPreview && (
              <div className={styles.preview}>{progress.currentPreview}</div>
            )}
          </>
        )}

        {phase === 'result' && (
          <>
            {fatal && <div className={styles.error}>{fatal}</div>}
            {summary && summary.status === 'completed' && (
              <div className={styles.ok}>
                {t('workspace.importDone', {
                  count: String(summary.executedCount),
                  ms: String(summary.durationMs)
                })}
              </div>
            )}
            {summary && summary.status === 'failed' && summary.failure && (
              <div className={styles.error}>
                <div>
                  {t('workspace.importFailed', {
                    index: String(summary.failure.statementIndex),
                    executed: String(summary.executedCount)
                  })}
                </div>
                <div className={styles.preview}>{summary.failure.statementPreview}</div>
                <div className={styles.msg}>{summary.failure.message}</div>
              </div>
            )}
            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={close}>
                {t('common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
