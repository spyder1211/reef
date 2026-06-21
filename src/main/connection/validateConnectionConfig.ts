import type { ConnectionConfig } from '../../shared/types'
import { t } from '../i18n'

export function validateConnectionConfig(config: Partial<ConnectionConfig>): string[] {
  const errors: string[] = []
  if (!config.host) errors.push(t('error.hostRequired'))
  if (config.port === undefined || config.port < 1 || config.port > 65535) {
    errors.push(t('error.portRange'))
  }
  if (!config.user) errors.push(t('error.userRequired'))
  return errors
}
