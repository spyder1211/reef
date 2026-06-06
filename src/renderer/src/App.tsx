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

  return status === 'connected' ? <WorkspaceShell /> : <HomeScreen />
}
