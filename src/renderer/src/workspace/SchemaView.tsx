import type { TableTab } from '../store/useAppStore'
import styles from './SchemaView.module.css'

// テーブルの構造（カラム・インデックス・DDL）を表示する読み取り専用ビュー。
// スキーマの取得は store の setTableView が lazy load する（ここでは tab.schema を描画するだけ）。
export default function SchemaView({ tab }: { tab: TableTab }): JSX.Element {
  if (tab.schemaError) return <div className={styles.message}>{tab.schemaError.message}</div>
  if (!tab.schema) return <div className={styles.message}>読み込み中…</div>
  const { columns, indexes, ddl } = tab.schema

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.heading}>カラム</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>名前</th>
              <th>型</th>
              <th>NULL</th>
              <th>キー</th>
              <th>デフォルト</th>
              <th>Extra</th>
              <th>コメント</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.name}>
                <td className={styles.colName}>{c.name}</td>
                <td className={styles.mono}>{c.type}</td>
                <td>{c.nullable ? 'YES' : 'NO'}</td>
                <td>{c.key}</td>
                <td>{c.default ?? <span className={styles.null}>NULL</span>}</td>
                <td>{c.extra}</td>
                <td>{c.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>インデックス</h3>
        {indexes.length === 0 ? (
          <div className={styles.empty}>インデックスはありません</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>名前</th>
                <th>カラム</th>
                <th>ユニーク</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((i) => (
                <tr key={i.name}>
                  <td className={styles.colName}>{i.name}</td>
                  <td className={styles.mono}>{i.columns.join(', ')}</td>
                  <td>{i.unique ? 'YES' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.heading}>DDL</h3>
        <pre className={styles.ddl}>{ddl}</pre>
      </section>
    </div>
  )
}
