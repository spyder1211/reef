import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n/useT'
import SettingsModal from './SettingsModal'
import appIcon from '../assets/app-icon.png'
import styles from './AppRail.module.css'

export default function AppRail(): JSX.Element {
  const { t } = useT()
  const openForm = useAppStore((s) => s.openForm)
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className={styles.rail}>
      <img className={styles.logo} src={appIcon} alt="Reef" width={64} height={64} />
      <div className={styles.name}>Reef</div>
      <div className={styles.version}>Version {__APP_VERSION__}</div>
      <div className={styles.spacer} />
      <button className={styles.railBtn} onClick={() => openForm()}>
        ＋ {t('home.newConnection')}
      </button>
      <button className={styles.railBtn} onClick={() => setSettingsOpen(true)}>
        ⚙ {t('home.settings')}
      </button>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
