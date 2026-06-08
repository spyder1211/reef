import { useEffect } from 'react'
import { useAppStore } from './store/useAppStore'
import HomeScreen from './home/HomeScreen'
import WorkspaceShell from './workspace/WorkspaceShell'

export default function App(): JSX.Element {
  const status = useAppStore((s) => s.status)
  const loadProfiles = useAppStore((s) => s.loadProfiles)

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  // ウィンドウの閉じる操作（接続中）で接続一覧へ戻す。最新状態を使うため getState() を参照。
  useEffect(() => {
    return window.api.onReturnToConnections(() => {
      void useAppStore.getState().returnToConnections()
    })
  }, [])

  return status === 'connected' ? <WorkspaceShell /> : <HomeScreen />
}
