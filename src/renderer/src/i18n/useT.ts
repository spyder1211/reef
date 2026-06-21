import { useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { createTranslator } from '../../../shared/i18n'

export function useT(): ReturnType<typeof createTranslator> {
  const locale = useAppStore((s) => s.locale)
  return useMemo(() => createTranslator(locale), [locale])
}
