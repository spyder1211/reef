import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n/useT'
import { filterTables, matchRange } from '../lib/tableSearch'
import { useAppStore } from '../store/useAppStore'
import ContextMenu from '../ui/ContextMenu'
import styles from './TableList.module.css'

export default function TableList(): JSX.Element {
  const { t } = useT()
  const tables = useAppStore((s) => s.tables)
  const selectTable = useAppStore((s) => s.selectTable)
  const truncateTable = useAppStore((s) => s.truncateTable)
  const dropTable = useAppStore((s) => s.dropTable)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [ctxMenu, setCtxMenu] = useState<{ table: string; x: number; y: number } | null>(null)

  // 入力に応じたフィルタ済みリスト。tables か query が変わったときだけ再計算。
  const filtered = useMemo(() => filterTables(tables, query), [tables, query])

  // クエリ／テーブル一覧が変わったらアクティブ行を先頭へ戻す（範囲外 index を防ぐ）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: query and tables are intentionally kept to reset index on change
  useEffect(() => {
    setActiveIndex(0)
  }, [query, tables])

  // ⌘P（macOS）/ Ctrl+P（その他）で検索ボックスへフォーカスし既存テキストを全選択。
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // アクティブ行を表示範囲内へスクロール。
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const open = (name: string): void => {
    void selectTable(name)
  }

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, Math.min(i + 1, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const name = filtered[activeIndex]
      if (name) open(name)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // 二段挙動: 入力があればクリア、空ならフォーカスを外す。
      if (query !== '') setQuery('')
      else inputRef.current?.blur()
    }
  }

  return (
    <div className={styles.tables}>
      <div className={styles.label}>TABLES</div>
      {tables.length > 0 && (
        <input
          ref={inputRef}
          className={styles.search}
          value={query}
          placeholder={t('workspace.tableSearch')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      )}
      <div className={styles.list} ref={listRef}>
        {tables.length === 0 ? (
          <div className={styles.empty}>{t('workspace.tableEmpty')}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>{t('workspace.tableNoResults')}</div>
        ) : (
          filtered.map((t, i) => (
            <button
              type="button"
              key={t}
              data-index={i}
              className={i === activeIndex ? `${styles.row} ${styles.active}` : styles.row}
              onClick={() => open(t)}
              onContextMenu={(e) => {
                e.preventDefault()
                setCtxMenu({ table: t, x: e.clientX, y: e.clientY })
              }}
              title={t}
            >
              <span className={styles.icon}>▸</span>
              <span className={styles.tname}>{renderName(t, query)}</span>
            </button>
          ))
        )}
      </div>
      {ctxMenu && (
        <ContextMenu
          open
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          className={styles.ctxMenu}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.ctxItem}
            onClick={() => {
              void navigator.clipboard.writeText(ctxMenu.table)
              setCtxMenu(null)
            }}
          >
            {t('workspace.copyTableName')}
          </button>
          {/* biome-ignore lint/a11y/useFocusableInteractive: static menu separator does not need focus */}
          {/* biome-ignore lint/a11y/useSemanticElements: div with CSS class matches existing separator styling */}
          {/* biome-ignore lint/a11y/useAriaPropsForRole: static separator in menu does not require aria-valuenow */}
          <div className={styles.ctxSep} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={styles.ctxItem}
            onClick={() => {
              void truncateTable(ctxMenu.table)
              setCtxMenu(null)
            }}
          >
            {t('workspace.truncateTable')}
          </button>
          {/* biome-ignore lint/a11y/useFocusableInteractive: static menu separator does not need focus */}
          {/* biome-ignore lint/a11y/useSemanticElements: div with CSS class matches existing separator styling */}
          {/* biome-ignore lint/a11y/useAriaPropsForRole: static separator in menu does not require aria-valuenow */}
          <div className={styles.ctxSep} role="separator" />
          <button
            type="button"
            role="menuitem"
            className={`${styles.ctxItem} ${styles.ctxDanger}`}
            onClick={() => {
              void dropTable(ctxMenu.table)
              setCtxMenu(null)
            }}
          >
            {t('workspace.dropTable')}
          </button>
        </ContextMenu>
      )}
    </div>
  )
}

// テーブル名を一致部分でハイライト分割する。query が空／一致なしならそのまま表示。
function renderName(name: string, query: string): JSX.Element {
  const range = matchRange(name, query)
  if (!range) return <>{name}</>
  return (
    <>
      {name.slice(0, range.start)}
      <mark className={styles.hl}>{name.slice(range.start, range.end)}</mark>
      {name.slice(range.end)}
    </>
  )
}
