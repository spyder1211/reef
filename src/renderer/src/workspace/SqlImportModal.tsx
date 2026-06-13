import { useEffect, useState } from 'react'
import type { ImportProgress, ImportSummary, SqlImportRequest } from '../../../shared/types'
import styles from './SqlImportModal.module.css'
import { isCancelled } from '../store/helpers'

type Phase = 'closed' | 'confirm' | 'running' | 'result'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function SqlImportModal(): JSX.Element | null {
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
        <div className={styles.title}>SQL ダンプを import / restore</div>

        {phase === 'confirm' && (
          <>
            <div className={styles.row}>
              <span className={styles.k}>接続中の DB</span>
              <b>{req.dbName || '(未選択)'}</b>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>ファイル</span>
              <span>{req.fileName}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>サイズ</span>
              <span>{formatBytes(req.totalBytes)}</span>
            </div>
            <div className={styles.warn}>
              この dump は <b>DROP / CREATE / INSERT</b> を含む可能性があり、対象 DB の既存データを
              上書きします。MySQL の DDL は暗黙コミットされるため、途中で失敗してもそこまでの変更は
              ロールバックされません。
            </div>
            <div className={styles.actions}>
              <button className={styles.btn} onClick={close}>
                キャンセル
              </button>
              <button className={styles.btnDanger} onClick={() => void handleRun()}>
                実行する
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
              <span className={styles.k}>進捗</span>
              <span>
                {pct}%（{formatBytes(progress.bytesRead)} / {formatBytes(progress.totalBytes)}）
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.k}>実行済み</span>
              <span>{progress.executedCount} 文</span>
            </div>
            {progress.currentPreview && <div className={styles.preview}>{progress.currentPreview}</div>}
          </>
        )}

        {phase === 'result' && (
          <>
            {fatal && <div className={styles.error}>{fatal}</div>}
            {summary && summary.status === 'completed' && (
              <div className={styles.ok}>
                完了：{summary.executedCount} 文を実行しました（{summary.durationMs} ms）
              </div>
            )}
            {summary && summary.status === 'failed' && summary.failure && (
              <div className={styles.error}>
                <div>
                  失敗：{summary.failure.statementIndex} 文目でエラー（ここまで {summary.executedCount}{' '}
                  文を適用済み）
                </div>
                <div className={styles.preview}>{summary.failure.statementPreview}</div>
                <div className={styles.msg}>{summary.failure.message}</div>
              </div>
            )}
            <div className={styles.actions}>
              <button className={styles.btnPrimary} onClick={close}>
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
