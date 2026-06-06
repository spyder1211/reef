import type { FilterOperator } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { buildFilteredQuery } from '../store/filterBuilder'
import { OPERATORS, OPERATOR_VALUE_KIND } from '../lib/filterOperators'
import styles from './FilterBar.module.css'

export default function FilterBar(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const addFilter = useAppStore((s) => s.addFilter)
  const removeFilter = useAppStore((s) => s.removeFilter)
  const updateFilter = useAppStore((s) => s.updateFilter)
  const clearFilters = useAppStore((s) => s.clearFilters)
  const applyFilters = useAppStore((s) => s.applyFilters)

  if (!tab) return null

  const preview = buildFilteredQuery(tab.tableName, tab.columns, tab.filters).sql

  return (
    <div className={styles.bar}>
      {tab.filters.length === 0 ? (
        <div className={styles.empty}>フィルターなし（先頭100行）</div>
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
                    {o.label}
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
                    placeholder="下限"
                    onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                  />
                  <span className={styles.tilde}>〜</span>
                  <input
                    className={styles.val}
                    value={f.value2}
                    placeholder="上限"
                    onChange={(e) => updateFilter(tab.id, f.id, { value2: e.target.value })}
                  />
                </span>
              ) : (
                <input
                  className={styles.val}
                  value={f.value}
                  placeholder={valueKind === 'list' ? 'カンマ区切り' : '値'}
                  onChange={(e) => updateFilter(tab.id, f.id, { value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void applyFilters(tab.id)
                  }}
                />
              )}
              <button className={styles.iconBtn} onClick={() => removeFilter(tab.id, f.id)} title="削除">
                −
              </button>
              <button className={styles.iconBtn} onClick={() => addFilter(tab.id)} title="条件を追加">
                ＋
              </button>
            </div>
          )
        })
      )}
      <div className={styles.footer}>
        <button className={styles.addBtn} onClick={() => addFilter(tab.id)}>
          ＋ 条件を追加
        </button>
        <div className={styles.spacer} />
        <button className={styles.clear} onClick={() => clearFilters(tab.id)}>
          Clear
        </button>
        <button className={styles.apply} onClick={() => void applyFilters(tab.id)}>
          Apply
        </button>
      </div>
      <div className={styles.preview} title={preview}>
        {preview}
      </div>
    </div>
  )
}
