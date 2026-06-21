import { useMemo } from 'react'
import { createTranslator } from '../../../shared/i18n'
import { useAppStore } from '../store/useAppStore'

export function useT(): ReturnType<typeof createTranslator> {
  const locale = useAppStore((s) => s.locale)
  return useMemo(() => createTranslator(locale), [locale])
}
