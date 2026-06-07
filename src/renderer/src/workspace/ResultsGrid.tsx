import { useMemo, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import type { QueryResult, TableSort, RowEdit } from '../../../shared/types'
import { useAppStore } from '../store/useAppStore'
import { rowKeyOf } from '../store/rowKey'
import styles from './ResultsGrid.module.css'

type Row = Record<string, unknown>

export default function ResultsGrid(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setSort = useAppStore((s) => s.setSort)
  const setCellEdit = useAppStore((s) => s.setCellEdit)
  const setCellNull = useAppStore((s) => s.setCellNull)
  const selectRow = useAppStore((s) => s.selectRow)

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
  const selectedRowIndex = isTable ? tab.selectedRowIndex : null
  const onSelectRow = isTable ? (index: number): void => selectRow(tab.id, index) : undefined

  return (
    <Grid
      result={tab.result}
      sort={sort}
      onSort={onSort}
      editable={editable}
      primaryKey={primaryKey}
      edits={edits}
      selectedRowIndex={selectedRowIndex}
      onSelectRow={onSelectRow}
      onEdit={editable ? (row, col, val) => setCellEdit(tab.id, row, col, val) : undefined}
      onNull={editable ? (row, col) => setCellNull(tab.id, row, col) : undefined}
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
  selectedRowIndex,
  onSelectRow,
  onEdit,
  onNull
}: {
  result: QueryResult
  sort: TableSort | null
  onSort?: (column: string) => void
  editable: boolean
  primaryKey: string[]
  edits: Record<string, RowEdit>
  selectedRowIndex: number | null
  onSelectRow?: (index: number) => void
  onEdit?: (row: Row, column: string, value: string) => void
  onNull?: (row: Row, column: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState<{ rowKey: string; column: string } | null>(null)
  const [draft, setDraft] = useState('')
  // Enter/Esc 確定後に trailing blur が再度 confirm するのを防ぐ（編集開始ごとにリセット）
  const committedRef = useRef(false)

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
    <div className={styles.gridWrap}>
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
            const rowEdit = editable ? edits[rowKey] : undefined
            return (
              <tr
                key={r.id}
                className={r.index === selectedRowIndex ? styles.selected : undefined}
                onClick={onSelectRow ? () => onSelectRow(r.index) : undefined}
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
                    <td key={cell.id} className={cls} onDoubleClick={editable ? startEdit : undefined}>
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
      </table>
    </div>
  )
}
