import type { TranslateParams } from './types'

export function translate(
  catalog: Record<string, string>,
  key: string,
  params?: TranslateParams
): string {
  const template = catalog[key]
  if (template === undefined) return key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m
  )
}

export function selectPlural(count: number): 'one' | 'other' {
  return count === 1 ? 'one' : 'other'
}
