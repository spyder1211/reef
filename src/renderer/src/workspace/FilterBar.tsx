import { useMemo, type KeyboardEvent } from 'react'
import type { FilterOperator } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { buildFilteredQuery, sameFilterEffect, countUsableFilters } from '../store/filterBuilder'
import { OPERATORS, OPERATOR_VALUE_KIND } from '../lib/filterOperators'
import { useT } from '../i18n/useT'
import ExportMenu from './ExportMenu'
import styles from './FilterBar.module.css'

export default function FilterBar(): JSX.Element | null {
  const { t, tPlural } = useT()
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const addFilter = useAppStore((s) => s.addFilter)
  const removeFilter = useAppStore((s) => s.removeFilter)
  const updateFilter = useAppStore((s) => s.updateFilter)
  const duplicateFilter = useAppStore((s) => s.duplicateFilter)
  const clearFilters = useAppStore((s) => s.clearFilters)
  const applyFilters = useAppStore((s) => s.applyFilters)

  // プレビューSQLは tab（filters/columns）が変わったときだけ再計算する。
  const preview = useMemo(
    () => (tab ? buildFilteredQuery(tab.tableName, tab.columns, tab.filters).sql : ''),
    [tab]
  )

  if (!tab) return null

  // 初回ロード中（columns 未取得）は条件追加を抑止する（column='' の死にフィルタ防止）。
  const columnsReady = tab.columns.length > 0
  // 適用状態: 編集中の filters が適用済みスナップショットと同じ効果かで判定する。
  const isDirty = !sameFilterEffect(tab.columns, tab.filters, tab.appliedFilters)
  const activeCount = countUsableFilters(tab.columns, tab.appliedFilters)
  const statusText = isDirty
    ? t('workspace.filterDirty')
    : activeCount > 0
      ? tPlural('workspace.filterActive', activeCount, { count: activeCount })
      : ''
  const applyOnEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !tab.running) void applyFilters(tab.id)
  }

  return (
    <div className={styles.bar}>
      {tab.filters.length === 0 ? (
        <div className={styles.empty}>{t('workspace.filterNone')}</div>
      ) : (
        tab.filters.map((f) => {
          const valueKind = OPERATOR_VALUE_KIND[f.operator]
          return (
            <div key={f.id} className={styles.row}>
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => updateFilter(tab.id, f.id, { enabled: e.target.checked })}
              />
              <select
                className={styles.sel}
                value={f.column}
                onChange={(e) => updateFilter(tab.id, f.id, { column: e.target.value })}
              >
                {tab.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                className={styles.sel}
                value={f.operator}
                onChange={(e) =>
                  updateFilter(tab.id, f.id, { operator: e.target.value as FilterOperator })
                }
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.labelKey ? t(o.labelKey) : o.label}
                  </option>
                ))}
              </select>
              {valueKind === 'none' ? (
                <span className={styles.valPlaceholder} />
              ) : valueKind === 'two' ? (
                <span className={styles.twoVals}>
                  <input
                    className={styles.val}
                    value={f.value}
                    placeholder={t('workspace.filterRangeFrom')}
                    onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                    onKeyDown={applyOnEnter}
                  />
                  <span className={styles.tilde}>〜</span>
                  <input
                    className={styles.val}
                    value={f.value2}
                    placeholder={t('workspace.filterRangeTo')}
                    onChange={(e) => updateFilter(tab.id, f.id, { value2: e.target.value })}
                    onKeyDown={applyOnEnter}
                  />
                </span>
              ) : (
                <input
                  className={styles.val}
                  value={f.value}
                  placeholder={valueKind === 'list' ? t('workspace.filterValueList') : t('workspace.filterValue')}
                  onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                  onKeyDown={applyOnEnter}
                />
              )}
              <button className={styles.iconBtn} onClick={() => removeFilter(tab.id, f.id)} title={t('workspace.filterRemove')}>
                −
              </button>
              <button
                className={styles.iconBtn}
                onClick={() => duplicateFilter(tab.id, f.id)}
                title={t('workspace.filterDuplicate')}
              >
                ⧉
              </button>
              <button
                className={styles.iconBtn}
                disabled={!columnsReady}
                onClick={() => addFilter(tab.id)}
                title={t('workspace.filterAdd')}
              >
                ＋
              </button>
            </div>
          )
        })
      )}
      <div className={styles.footer}>
        <button className={styles.addBtn} disabled={!columnsReady} onClick={() => addFilter(tab.id)}>
          {t('workspace.filterAddBtn')}
        </button>
        {statusText && (
          <span className={isDirty ? `${styles.status} ${styles.statusDirty}` : styles.status}>
            {statusText}
          </span>
        )}
        <div className={styles.spacer} />
        <ExportMenu disabled={!tab.result || tab.running} />
        <button
          className={styles.clear}
          onClick={() => {
            clearFilters(tab.id)
            void applyFilters(tab.id)
          }}
        >
          Clear
        </button>
        <button
          className={isDirty ? `${styles.apply} ${styles.applyDirty}` : styles.apply}
          disabled={tab.running}
          onClick={() => void applyFilters(tab.id)}
        >
          Apply
        </button>
      </div>
      <div className={styles.preview} title={preview}>
        {(isDirty ? t('workspace.filterPreviewDirty') : t('workspace.filterPreviewApplied')) + preview}
      </div>
    </div>
  )
}
