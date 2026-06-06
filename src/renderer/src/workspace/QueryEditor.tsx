import CodeMirror from '@uiw/react-codemirror'
import { sql, MySQL } from '@codemirror/lang-sql'
import { keymap } from '@codemirror/view'
import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import styles from './QueryEditor.module.css'

export default function QueryEditor(): JSX.Element | null {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const setTabSql = useAppStore((s) => s.setTabSql)
  const runActiveTab = useAppStore((s) => s.runActiveTab)

  // extensions は安定参照にする（毎レンダー再生成すると CodeMirror が打鍵ごとに reconfigure する）。
  // runActiveTab は zustand の安定参照なので、実質マウント時のみ生成される。
  const extensions = useMemo(
    () => [
      sql({ dialect: MySQL }),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            void runActiveTab()
            return true
          }
        }
      ])
    ],
    [runActiveTab]
  )

  if (!tab) return null

  return (
    <div className={styles.editor}>
      <CodeMirror
        key={activeTabId ?? 'none'}
        value={tab.sql}
        height="100%"
        theme="light"
        extensions={extensions}
        basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
        onChange={(value) => setTabSql(tab.id, value)}
      />
      <div className={styles.hint}>⌘↵ で実行</div>
    </div>
  )
}
