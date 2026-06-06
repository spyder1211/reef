import type { ConnectionConfig } from '../../shared/types'

export function validateConnectionConfig(config: Partial<ConnectionConfig>): string[] {
  const errors: string[] = []
  if (!config.host) errors.push('host は必須です')
  if (config.port === undefined || config.port < 1 || config.port > 65535) {
    errors.push('port は 1〜65535 の範囲で指定してください')
  }
  if (!config.user) errors.push('user は必須です')
  return errors
}
