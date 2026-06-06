import { useAppStore } from '../store/useAppStore'
import styles from './TableList.module.css'

export default function TableList(): JSX.Element {
  const tables = useAppStore((s) => s.tables)
  const selectTable = useAppStore((s) => s.selectTable)

  return (
    <div className={styles.tables}>
      <div className={styles.label}>TABLES</div>
      {tables.length === 0 ? (
        <div className={styles.empty}>テーブルがありません</div>
      ) : (
        tables.map((t) => (
          <button key={t} className={styles.row} onClick={() => void selectTable(t)} title={t}>
            <span className={styles.icon}>▸</span>
            <span className={styles.tname}>{t}</span>
          </button>
        ))
      )}
    </div>
  )
}
