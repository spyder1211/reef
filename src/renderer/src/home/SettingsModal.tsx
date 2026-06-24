import type { LocalePreference } from '../../../shared/i18n/types'
import { useT } from '../i18n/useT'
import { useAppStore } from '../store/useAppStore'
import Modal from '../ui/Modal'
import styles from './SettingsModal.module.css'

export default function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useT()
  const preference = useAppStore((s) => s.localePreference)
  const setLocalePreference = useAppStore((s) => s.setLocalePreference)

  const options: { value: LocalePreference; label: string }[] = [
    { value: 'auto', label: t('settings.language.auto') },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' }
  ]

  return (
    <Modal open onClose={onClose} ariaLabel={t('settings.title')} className={styles.modal}>
      <h2 className={styles.title}>{t('settings.title')}</h2>
      <label className={styles.row}>
        <span>{t('settings.language')}</span>
        <select
          value={preference}
          onChange={(e) => void setLocalePreference(e.target.value as LocalePreference)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={styles.close} onClick={onClose}>
        {t('common.close')}
      </button>
    </Modal>
  )
}
