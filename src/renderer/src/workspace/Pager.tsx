import { useAppStore } from '../store/useAppStore'
import { totalPages, pageRange, canGoNext } from '../store/pager'
import styles from './Pager.module.css'

const PAGE_SIZES = [50, 100, 500]

export default function Pager(): JSX.Element | null {
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'table' ? t : null
  })
  const setPage = useAppStore((s) => s.setPage)
  const setPageSize = useAppStore((s) => s.setPageSize)

  if (!tab) return null

  const returned = tab.result?.rows.length ?? 0
  const pages = totalPages(tab.total, tab.pageSize)
  const { start, end } = pageRange(tab.page, tab.pageSize, returned)
  const prevOk = tab.page > 0 && !tab.running
  const nextOk = canGoNext(tab.page, tab.pageSize, tab.total, returned) && !tab.running

  return (
    <div className={styles.pager}>
      <label className={styles.size}>
        ページサイズ
        <select
          value={tab.pageSize}
          disabled={tab.running}
          onChange={(e) => void setPageSize(tab.id, Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.nav}>
        <button disabled={!prevOk} onClick={() => void setPage(tab.id, tab.page - 1)}>
          ◀ 前へ
        </button>
        <span className={styles.pageNo}>
          ページ {tab.page + 1} / {pages ?? '?'}
        </span>
        <button disabled={!nextOk} onClick={() => void setPage(tab.id, tab.page + 1)}>
          次へ ▶
        </button>
      </div>

      <div className={styles.range}>
        {tab.total !== null
          ? `${start}–${end} / ${tab.total.toLocaleString()} 行`
          : `${start}–${end} 行目`}
      </div>
    </div>
  )
}
