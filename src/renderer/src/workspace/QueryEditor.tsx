import CodeMirror from '@uiw/react-codemirror'
import { sql, MySQL } from '@codemirror/lang-sql'
import { keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useColorScheme } from '../lib/useColorScheme'
import { useT } from '../i18n/useT'
import styles from './QueryEditor.module.css'

export default function QueryEditor(): JSX.Element | null {
  const { t } = useT()
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useAppStore((s) => {
    const t = s.tabs.find((t) => t.id === s.activeTabId)
    return t && t.kind === 'sql' ? t : null
  })
  const setTabSql = useAppStore((s) => s.setTabSql)
  const runActiveTab = useAppStore((s) => s.runActiveTab)
  const explainActiveTab = useAppStore((s) => s.explainActiveTab)
  // 補完用のテーブル→カラムマップ。接続時/テーブル変更時のみ更新される（打鍵では変わらない）。
  const schemaMap = useAppStore((s) => s.schemaMap)
  const scheme = useColorScheme()

  // extensions は安定参照にする（毎レンダー再生成すると CodeMirror が打鍵ごとに reconfigure する）。
  // runActiveTab は zustand の安定参照。schemaMap は接続後にほぼ不変なので再生成は実質起きない。
  const extensions = useMemo(
    () => [
      sql({ dialect: MySQL, schema: schemaMap, upperCaseKeywords: true }),
      // Prec.highest で basicSetup の defaultKeymap（Mod-Enter=insertBlankLine）に勝たせる。
      // これが無いと Cmd+Enter が空行挿入に奪われ、実行されない。
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              void runActiveTab()
              return true
            }
          },
          {
            key: 'Mod-e',
            run: () => {
              void explainActiveTab()
              return true
            }
          }
        ])
      )
    ],
    [runActiveTab, explainActiveTab, schemaMap]
  )

  if (!tab) return null

  return (
    <div className={styles.editor}>
      <CodeMirror
        key={activeTabId ?? 'none'}
        value={tab.sql}
        height="100%"
        theme={scheme}
        extensions={extensions}
        basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
        onChange={(value) => setTabSql(tab.id, value)}
      />
      <div className={styles.hint}>{t('workspace.editorHint')}</div>
    </div>
  )
}
