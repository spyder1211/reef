import { useMemo, useRef, useState, useEffect } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import type {
  QueryResult,
  TableSort,
  RowEdit,
  PendingInsert,
  FilterOperator
} from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { rowKeyOf, pkValuesOf } from '../store/rowKey'
import { toTsv } from '../lib/csv'
import styles from './ResultsGrid.module.css'

type Row = Record<string, unknown>

type CtxMenu =
  | {
      kind: 'cell'
      x: number
      y: number
      column: string
      value: unknown
    }
  | { kind: 'insert'; x: number; y: number; localId: string }

export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setSort = useAppStore((s) => s.setSort)
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const setSelectedRows = useAppStore((s) => s.setSelectedRows)
  const updateInsertCell = useAppStore((s) => s.updateInsertCell)
  const removeInsertRow = useAppStore((s) => s.removeInsertRow)
  const stageDeleteMany = useAppStore((s) => s.stageDeleteMany)
  const duplicateRows = useAppStore((s) => s.duplicateRows)
  const quickFilter = useAppStore((s) => s.quickFilter)

  if (!tab) return <div className={styles.placeholder} />
  if (tab.running) return <div className={styles.placeholder}>実行中…</div>
  if (tab.error) {
    return (
      <div className={styles.errorBox}>
        <b>{tab.error.code}</b>: {tab.error.message}
      </div>
    )
  }
  if (!tab.result) {
    return <div className={styles.placeholder}>クエリを実行してください（⌘↵）</div>
  }

  const isTable = tab.kind === 'table'
  const sort = isTable ? tab.sort : null
  const onSort = isTable ? (column: string): void => void setSort(tab.id, column) : undefined
  // 編集はテーブルタブ かつ 主キーありのときのみ
  const editable = isTable && tab.primaryKey.length > 0
  const primaryKey = isTable ? tab.primaryKey : []
  const edits = isTable ? tab.edits : {}
  const inserts = isTable ? tab.inserts : []
  const deletes = isTable ? tab.deletes : {}
  const selectedRowIndices = isTable ? tab.selectedRowIndices : []
  const selectionAnchor = isTable ? tab.selectionAnchor : null
  const onSetSelection = isTable
    ? (indices: number[], anchor: number | null): void => setSelectedRows(tab.id, indices, anchor)
    : undefined
  // quick filter はテーブルタブのみ（SQL タブはクエリを所有しないため）。主キー不要。
  const onQuickFilter = isTable
    ? (column: string, operator: FilterOperator, value: unknown): void =>
        void quickFilter(tab.id, column, operator, value)
    : undefined

  return (
    <Grid
      result={tab.result}
      sort={sort}
      onSort={onSort}
      editable={editable}
      primaryKey={primaryKey}
      edits={edits}
      inserts={inserts}
      deletes={deletes}
      selectedRowIndices={selectedRowIndices}
      selectionAnchor={selectionAnchor}
      rowCount={tab.result?.rows.length ?? 0}
      onSetSelection={onSetSelection}
      onEdit={editable ? (row, col, val) => setCellEdit(tab.id, row, col, val) : undefined}
      onNull={editable ? (row, col) => setCellNull(tab.id, row, col) : undefined}
      onUpdateInsert={
        editable ? (localId, col, val) => updateInsertCell(tab.id, localId, col, val) : undefined
      }
      onRemoveInsert={editable ? (localId) => removeInsertRow(tab.id, localId) : undefined}
      onStageDeleteMany={
        editable
          ? (entries): void => stageDeleteMany(tab.id, entries)
          : undefined
      }
      onDuplicateRows={
        editable ? (indices): void => duplicateRows(tab.id, indices) : undefined
      }
      onQuickFilter={onQuickFilter}
    />
  )
}

function Grid({
  result,
  sort,
  onSort,
  editable,
  primaryKey,
  edits,
  inserts,
  deletes,
  selectedRowIndices,
  selectionAnchor,
  rowCount,
  onSetSelection,
  onEdit,
  onNull,
  onUpdateInsert,
  onRemoveInsert,
  onStageDeleteMany,
  onDuplicateRows,
  onQuickFilter
}: {
  result: QueryResult
  sort: TableSort | null
  onSort?: (column: string) => void
  editable: boolean
  primaryKey: string[]
  edits: Record<string, RowEdit>
  inserts: PendingInsert[]
  deletes: Record<string, Record<string, unknown>>
  selectedRowIndices: number[]
  selectionAnchor: number | null
  rowCount: number
  onSetSelection?: (indices: number[], anchor: number | null) => void
  onEdit?: (row: Row, column: string, value: string) => void
  onNull?: (row: Row, column: string) => void
  onUpdateInsert?: (localId: string, column: string, value: string) => void
  onRemoveInsert?: (localId: string) => void
  onStageDeleteMany?: (entries: { rowKey: string; pkValues: Record<string, unknown> }[]) => void
  onDuplicateRows?: (indices: number[]) => void
  onQuickFilter?: (column: string, operator: FilterOperator, value: unknown) => void
}): JSX.Element {
  const [editing, setEditing] = useState<{ rowKey: string; column: string } | null>(null)
  const [draft, setDraft] = useState('')
  // Enter/Esc 確定後に trailing blur が再度 confirm するのを防ぐ（編集開始ごとにリセット）
  const committedRef = useRef(false)

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  const selectedSet = useMemo(() => new Set(selectedRowIndices), [selectedRowIndices])

  const copySelectedRows = (indices: number[]): void => {
    const colNames = result.columns.map((c) => c.name)
    const rows = indices
      .filter((i) => i < result.rows.length)
      .sort((a, b) => a - b)
      .map((i) => result.rows[i] as Row)
    if (rows.length === 0) return
    void navigator.clipboard.writeText(toTsv(colNames, rows))
  }

  // クリック + 修飾キーから次の選択集合を計算して通知する。
  const handleRowMouseDown = (index: number, e: React.MouseEvent): void => {
    if (!onSetSelection) return
    if (e.shiftKey) {
      e.preventDefault() // Shift+クリックでテキスト選択が走るのを防ぐ
      const anchor = selectionAnchor ?? index
      const lo = Math.min(anchor, index)
      const hi = Math.max(anchor, index)
      const range: number[] = []
      for (let i = lo; i <= hi; i++) range.push(i)
      onSetSelection(range, anchor)
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedSet)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      onSetSelection([...next], index)
    } else {
      onSetSelection([index], index)
    }
  }

  // コンテキストメニューをページ外クリックで閉じる
  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [ctxMenu])

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      result.columns.map((c) => ({
        id: c.name,
        header: c.name,
        accessorFn: (row) => row[c.name]
      })),
    [result.columns]
  )

  const table = useReactTable({
    data: result.rows as Row[],
    columns,
    getCoreRowModel: getCoreRowModel()
  })

  if (result.columns.length === 0) {
    return <div className={styles.placeholder}>結果なし（{result.rowCount} 行）</div>
  }

  return (
    <div
      className={styles.gridWrap}
      tabIndex={0}
      onKeyDown={(e) => {
        if (editing) return // セル編集中の入力を奪わない
        if (!onSetSelection) return
        if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault()
          // ⌘A は結果行のみ選択する（バルク操作対象は結果行のみ。INSERT 行はバルク対象外のため除外）
          const all: number[] = []
          for (let i = 0; i < rowCount; i++) all.push(i)
          onSetSelection(all, 0)
        } else if (e.key === 'Escape') {
          onSetSelection([], null)
        }
      }}
    >
      <table className={styles.grid}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const name = h.column.id
                const active = sort?.column === name
                return (
                  <th
                    key={h.id}
                    className={onSort ? styles.sortable : undefined}
                    onClick={onSort ? () => onSort(name) : undefined}
                  >
                    {primaryKey.includes(name) && <span className={styles.pkIcon}>🔑 </span>}
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {active && (
                      <span className={styles.sortInd}>{sort.dir === 'asc' ? '▲' : '▼'}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => {
            const original = r.original as Row
            const rowKey = editable ? rowKeyOf(primaryKey, original) : ''
            const isDeleted = editable && rowKey in deletes
            const rowEdit = editable ? edits[rowKey] : undefined

            return (
              <tr
                key={r.id}
                className={
                  isDeleted
                    ? styles.deleteRow
                    : selectedSet.has(r.index)
                      ? styles.selected
                      : undefined
                }
                onMouseDown={(e) => handleRowMouseDown(r.index, e)}
              >
                {r.getVisibleCells().map((cell) => {
                  const colId = cell.column.id
                  const isDirty = rowEdit ? colId in rowEdit.values : false
                  const value = isDirty ? rowEdit!.values[colId] : (cell.getValue() as unknown)
                  const isEditingThis = editing?.rowKey === rowKey && editing?.column === colId

                  const startEdit = (): void => {
                    if (!editable) return
                    committedRef.current = false
                    setEditing({ rowKey, column: colId })
                    setDraft(value === null || value === undefined ? '' : String(value))
                  }
                  const confirm = (): void => {
                    if (committedRef.current) return
                    committedRef.current = true
                    onEdit?.(original, colId, draft)
                    setEditing(null)
                  }
                  const cancel = (): void => {
                    committedRef.current = true
                    setEditing(null)
                  }
                  const setNull = (): void => {
                    committedRef.current = true
                    onNull?.(original, colId)
                    setEditing(null)
                  }

                  const cls =
                    [isDirty ? styles.dirty : '', isEditingThis ? styles.editing : '']
                      .filter(Boolean)
                      .join(' ') || undefined

                  return (
                    <td
                      key={cell.id}
                      className={cls}
                      onDoubleClick={editable && !isDeleted ? startEdit : undefined}
                      onContextMenu={
                        onQuickFilter
                          ? (e) => {
                              e.preventDefault()
                              // 右クリック行が選択に含まれていなければ単一選択に畳む。含まれていれば選択維持。
                              if (!selectedSet.has(r.index)) onSetSelection?.([r.index], r.index)
                              setCtxMenu({
                                kind: 'cell',
                                x: e.clientX,
                                y: e.clientY,
                                column: colId,
                                value: original[colId]
                              })
                            }
                          : undefined
                      }
                    >
                      {isEditingThis ? (
                        <span className={styles.editWrap}>
                          <input
                            autoFocus
                            className={styles.editInput}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirm()
                              else if (e.key === 'Escape') cancel()
                            }}
                            onBlur={confirm}
                          />
                          <button
                            className={styles.nullBtn}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              setNull()
                            }}
                          >
                            NULL
                          </button>
                        </span>
                      ) : value === null || value === undefined ? (
                        <span className={styles.null}>NULL</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        <tbody>
          {inserts.map((insert, insertIndex) => (
            <tr
              key={insert.localId}
              className={
                selectedSet.has(result.rows.length + insertIndex)
                  ? `${styles.insertRow} ${styles.selected}`
                  : styles.insertRow
              }
              onClick={() =>
                onSetSelection?.(
                  [result.rows.length + insertIndex],
                  result.rows.length + insertIndex
                )
              }
              onContextMenu={(e) => {
                e.preventDefault()
                onSetSelection?.(
                  [result.rows.length + insertIndex],
                  result.rows.length + insertIndex
                )
                setCtxMenu({ kind: 'insert', x: e.clientX, y: e.clientY, localId: insert.localId })
              }}
            >
              {result.columns.map((col) => {
                const value = insert.values[col.name]
                const colId = col.name
                const isEditingThis =
                  editing?.rowKey === `insert-${insert.localId}` && editing?.column === colId

                const startEdit = (): void => {
                  if (!editable) return
                  committedRef.current = false
                  setEditing({ rowKey: `insert-${insert.localId}`, column: colId })
                  setDraft(value === null || value === undefined ? '' : String(value))
                }
                const confirm = (): void => {
                  if (committedRef.current) return
                  committedRef.current = true
                  onUpdateInsert?.(insert.localId, colId, draft)
                  setEditing(null)
                }
                const cancel = (): void => {
                  committedRef.current = true
                  setEditing(null)
                }

                const cls = isEditingThis ? styles.editing : undefined
                return (
                  <td
                    key={colId}
                    className={cls}
                    onDoubleClick={editable ? startEdit : undefined}
                  >
                    {isEditingThis ? (
                      <span className={styles.editWrap}>
                        <input
                          autoFocus
                          className={styles.editInput}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirm()
                            else if (e.key === 'Escape') cancel()
                          }}
                          onBlur={confirm}
                        />
                      </span>
                    ) : value === null ? (
                      <span className={styles.null}>NULL</span>
                    ) : value === undefined || value === '' ? (
                      <span className={styles.insertAutoCell}>—</span>
                    ) : (
                      String(value)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {ctxMenu && (
        <div
          className={styles.ctxMenu}
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.kind === 'cell' && (
            <>
              {ctxMenu.value === null || ctxMenu.value === undefined ? (
                <>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, 'is_null', null)
                      setCtxMenu(null)
                    }}
                  >
                    IS NULL
                  </div>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, 'is_not_null', null)
                      setCtxMenu(null)
                    }}
                  >
                    IS NOT NULL
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, '=', ctxMenu.value)
                      setCtxMenu(null)
                    }}
                  >
                    = この値で絞り込む
                  </div>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, '<>', ctxMenu.value)
                      setCtxMenu(null)
                    }}
                  >
                    ≠ この値
                  </div>
                  <div
                    className={styles.ctxItem}
                    onClick={() => {
                      onQuickFilter?.(ctxMenu.column, 'contains', ctxMenu.value)
                      setCtxMenu(null)
                    }}
                  >
                    含む
                  </div>
                </>
              )}
              {onStageDeleteMany && (() => {
                // 選択中の結果行のみ対象（INSERT 行・範囲外は除外）。
                const targets = [...selectedSet].filter((i) => i < result.rows.length).sort((a, b) => a - b)
                if (targets.length === 0) return null
                const entries = targets.map((i) => {
                  const row = result.rows[i] as Row
                  return { rowKey: rowKeyOf(primaryKey, row), pkValues: pkValuesOf(primaryKey, row) }
                })
                const allStaged = entries.every((e) => e.rowKey in deletes)
                const n = targets.length
                return (
                  <>
                    <div className={styles.ctxSep} />
                    <div
                      className={`${styles.ctxItem} ${allStaged ? '' : styles.ctxDanger}`}
                      onClick={() => {
                        onStageDeleteMany(entries)
                        setCtxMenu(null)
                      }}
                    >
                      {allStaged ? `削除を取り消す（${n} 行）` : `選択 ${n} 行を削除`}
                    </div>
                    <div
                      className={styles.ctxItem}
                      onClick={() => {
                        onDuplicateRows?.(targets)
                        setCtxMenu(null)
                      }}
                    >
                      選択 {n} 行を複製
                    </div>
                    <div
                      className={styles.ctxItem}
                      onClick={() => {
                        copySelectedRows(targets)
                        setCtxMenu(null)
                      }}
                    >
                      選択 {n} 行をコピー
                    </div>
                  </>
                )
              })()}
            </>
          )}
          {ctxMenu.kind === 'insert' && (
            <div
              className={`${styles.ctxItem} ${styles.ctxDanger}`}
              onClick={() => {
                onRemoveInsert?.(ctxMenu.localId)
                setCtxMenu(null)
              }}
            >
              この新規行を破棄
            </div>
          )}
        </div>
      )}
    </div>
  )
}
