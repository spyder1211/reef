import { useAppStore } from '../store/useAppStore'
import { useT } from '../i18n/useT'
import type { LocalePreference } from '../../../shared/i18n/types'
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
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
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
        <button className={styles.close} onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
