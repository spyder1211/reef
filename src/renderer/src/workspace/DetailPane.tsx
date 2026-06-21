import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { rowKeyOf } from '../store/rowKey'
import { tryFormatJson } from '../lib/formatJson'
import { useT } from '../i18n/useT'
import styles from './DetailPane.module.css'

type Row = Record<string, unknown>

export default function DetailPane(): JSX.Element | null {
  const { t } = useT()
  const tab = useAppStore((s) => {
    const tt = s.tabs.find((t) => t.id === s.activeTabId)
    return tt && tt.kind === 'table' ? tt : null
  })
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const toggleDetail = useAppStore((s) => s.toggleDetail)
  // 列名 → JSON 整形ビューの展開状態（読み取り専用の追加表示）。
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (!tab) return null

  const result = tab.result
  const index = tab.selectedRowIndices.length === 1 ? tab.selectedRowIndices[0] : null
  const isInsertRow = index != null && result != null && index >= result.rows.length
  const row =
    result && index != null && !isInsertRow ? (result.rows[index] as Row | undefined) : undefined
  const editable = tab.primaryKey.length > 0
  const rowKey = row && editable ? rowKeyOf(tab.primaryKey, row) : ''
  const rowEdit = row && editable ? tab.edits[rowKey] : undefined
  // 削除ステージング済みの行はグリッド同様に編集不可（ペインでの編集を抑止）。
  const isDeleted = !!row && editable && rowKey in tab.deletes

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <span>{t('workspace.detailTitle')}</span>
        <button className={styles.close} onClick={() => toggleDetail()} title={t('common.close')}>
          ✕
        </button>
      </div>
      {isInsertRow ? (
        <div className={styles.placeholder}>{t('workspace.detailInsertHint')}</div>
      ) : !row || !result ? (
        <div className={styles.placeholder}>{t('workspace.detailSelectHint')}</div>
      ) : isDeleted ? (
        <div className={styles.placeholder}>{t('workspace.detailDeletedHint')}</div>
      ) : (
        <div className={styles.body}>
          {result.columns.map((col) => {
            const isDirty = rowEdit ? col.name in rowEdit.values : false
            const value = isDirty ? rowEdit!.values[col.name] : (row[col.name] as unknown)
            const isNull = value === null || value === undefined
            const text = isNull ? '' : String(value)
            const long = text.length > 40
            const inputCls = [styles.val, isDirty ? styles.dirty : ''].filter(Boolean).join(' ')
            // JSON のオブジェクト/配列なら整形表示トグルを出す（非 JSON は null）。
            const formatted = isNull ? null : tryFormatJson(text)
            const isExpanded = !!expanded[col.name]
            return (
              <div key={col.name} className={styles.field}>
                <div className={styles.fhead}>
                  <span className={styles.fname}>{col.name}</span>
                  {col.type && <span className={styles.ftype}>{col.type}</span>}
                  {formatted !== null && (
                    <button
                      className={styles.jsonToggle}
                      onClick={() => setExpanded((m) => ({ ...m, [col.name]: !m[col.name] }))}
                      title={
                        isExpanded
                          ? t('workspace.detailJsonCollapse')
                          : t('workspace.detailJsonExpand')
                      }
                    >
                      {'{ }'}
                    </button>
                  )}
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
                {formatted !== null && isExpanded && (
                  <pre className={styles.jsonView}>{formatted}</pre>
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
                        {t('workspace.detailSetNull')}
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
