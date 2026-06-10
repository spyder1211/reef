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

  return (
    <>
      {status === 'connected' ? <WorkspaceShell /> : <HomeScreen />}
      <SqlImportModal />
    </>
  )
}
