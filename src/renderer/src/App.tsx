import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import HomeScreen from './home/HomeScreen'
import WorkspaceShell from './workspace/WorkspaceShell'
import SqlImportModal from './workspace/SqlImportModal'

export default function App(): JSX.Element {
  const status = useAppStore((s) => s.status)
  const loadProfiles = useAppStore((s) => s.loadProfiles)
  const loadGroups = useAppStore((s) => s.loadGroups)

  useEffect(() => {
    void loadProfiles()
    void loadGroups()
  }, [loadProfiles, loadGroups])

  // ウィンドウの閉じる操作（接続中）で接続一覧へ戻す。最新状態を使うため getState() を参照。
  useEffect(() => {
    return window.api.onReturnToConnections(() => {
      void useAppStore.getState().returnToConnections()
    })
  }, [])

  // Cmd+R（View →「再読み込み」）で現在のアクティブタブを再実行する。
  // 未接続時やタブ未選択時は runActiveTab が何もしないため、ガード不要。
  useEffect(() => {
    return window.api.onReloadActiveTab(() => {
      void useAppStore.getState().runActiveTab()
    })
  }, [])

  return (
    <>
      {status === 'connected' ? <WorkspaceShell /> : <HomeScreen />}
      <SqlImportModal />
    </>
  )
}
