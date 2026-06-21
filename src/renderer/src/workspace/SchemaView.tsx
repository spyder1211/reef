import type { TableTab } from '../store/useAppStore'
import { useT } from '../i18n/useT'
import type { TranslationKey } from '../../../shared/i18n'
import styles from './SchemaView.module.css'

// テーブルの構造（カラム・インデックス・DDL）を表示する読み取り専用ビュー。
// スキーマの取得は store の setTableView が lazy load する（ここでは tab.schema を描画するだけ）。
export default function SchemaView({ tab }: { tab: TableTab }): JSX.Element {
  const { t } = useT()
  if (tab.schemaError)
    return (
      <div className={styles.message}>
        {tab.schemaError.messageKey
          ? t(tab.schemaError.messageKey as TranslationKey)
          : tab.schemaError.message}
      </div>
    )
  if (!tab.schema) return <div className={styles.message}>{t('workspace.schemaLoading')}</div>
  const { columns, indexes, ddl } = tab.schema

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.heading}>{t('workspace.schemaColumns')}</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('workspace.schemaColName')}</th>
              <th>{t('workspace.schemaColType')}</th>
              <th>{t('workspace.schemaColNull')}</th>
              <th>{t('workspace.schemaColKey')}</th>
              <th>{t('workspace.schemaColDefault')}</th>
              <th>{t('workspace.schemaColExtra')}</th>
              <th>{t('workspace.schemaColComment')}</th>
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
        <h3 className={styles.heading}>{t('workspace.schemaIndexes')}</h3>
        {indexes.length === 0 ? (
          <div className={styles.empty}>{t('workspace.schemaNoIndexes')}</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('workspace.schemaIndexName')}</th>
                <th>{t('workspace.schemaIndexCols')}</th>
                <th>{t('workspace.schemaIndexUnique')}</th>
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
        <h3 className={styles.heading}>{t('workspace.schemaDdl')}</h3>
        <pre className={styles.ddl}>{ddl}</pre>
      </section>
    </div>
  )
}
