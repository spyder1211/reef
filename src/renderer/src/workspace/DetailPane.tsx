import { useAppStore } from '../store/useAppStore'
import { rowKeyOf } from '../store/rowKey'
import styles from './DetailPane.module.css'

type Row = Record<string, unknown>

export default function DetailPane(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const toggleDetail = useAppStore((s) => s.toggleDetail)

  if (!tab) return null

  const result = tab.result
  const index = tab.selectedRowIndex
  const row = result && index != null ? (result.rows[index] as Row | undefined) : undefined
  const editable = tab.primaryKey.length > 0
  const rowKey = row && editable ? rowKeyOf(tab.primaryKey, row) : ''
  const rowEdit = row && editable ? tab.edits[rowKey] : undefined

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <span>レコード詳細</span>
        <button className={styles.close} onClick={() => toggleDetail()} title="閉じる">
          ✕
        </button>
      </div>
      {!row || !result ? (
        <div className={styles.placeholder}>行を選択してください</div>
      ) : (
        <div className={styles.body}>
          {result.columns.map((col) => {
            const isDirty = rowEdit ? col.name in rowEdit.values : false
            const value = isDirty ? rowEdit!.values[col.name] : (row[col.name] as unknown)
            const isNull = value === null || value === undefined
            const text = isNull ? '' : String(value)
            const long = text.length > 40
            const inputCls = [styles.val, isDirty ? styles.dirty : ''].filter(Boolean).join(' ')
            return (
              <div key={col.name} className={styles.field}>
                <div className={styles.fhead}>
                  <span className={styles.fname}>{col.name}</span>
                  {col.type && <span className={styles.ftype}>{col.type}</span>}
                </div>
                {long ? (
                  <textarea
                    className={`${inputCls} ${styles.area}`}
                    value={text}
                    disabled={!editable}
                    onChange={(e) => setCellEdit(tab.id, row, col.name, e.target.value)}
                  />
                ) : (
                  <input
                    className={inputCls}
                    value={text}
                    disabled={!editable}
                    placeholder={isNull ? 'NULL' : ''}
                    onChange={(e) => setCellEdit(tab.id, row, col.name, e.target.value)}
                  />
                )}
                {editable && (
                  <div className={styles.nullRow}>
                    {isNull ? (
                      <span className={styles.nullTag}>NULL</span>
                    ) : (
                      <button
                        className={styles.nullBtn}
                        onClick={() => setCellNull(tab.id, row, col.name)}
                      >
                        NULL に設定
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
