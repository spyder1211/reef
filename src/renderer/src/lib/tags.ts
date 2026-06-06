import type { ConnectionTag } from '../../../shared/types'

export const TAG_ORDER: ConnectionTag[] = ['production', 'staging', 'development', 'local', 'none']

export const TAG_COLORS: Record<ConnectionTag, string> = {
  production: '#ff453a',
  staging: '#0a84ff',
  development: '#30b0c7',
  local: '#34c759',
  none: '#8e8e93'
}

export const TAG_LABELS: Record<ConnectionTag, string> = {
  production: 'production',
  staging: 'staging',
  development: 'development',
  local: 'local',
  none: ''
}

export function initials(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9぀-ヿ一-龯]/g, '')
  return cleaned.slice(0, 2).toLowerCase() || '??'
}
