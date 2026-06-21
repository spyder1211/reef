import type { FilterOperator } from '../../../shared/types'
import type { TranslationKey } from '../../../shared/i18n'

export type OperatorValueKind = 'none' | 'single' | 'two' | 'list'

export interface OperatorMeta {
  value: FilterOperator
  // Static symbol labels (=, ≠, IN, etc.) are stored directly in `label`.
  // Translatable labels use `labelKey`; the display component calls t(labelKey).
  label?: string
  labelKey?: TranslationKey
}

export const OPERATORS: OperatorMeta[] = [
  { value: '=', label: '=' },
  { value: '<>', label: '≠' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '<=', label: '≤' },
  { value: '>=', label: '≥' },
  { value: 'contains', labelKey: 'workspace.filterContains' },
  { value: 'not_contains', labelKey: 'workspace.filterNotContains' },
  { value: 'in', label: 'IN' },
  { value: 'between', label: 'BETWEEN' },
  { value: 'is_null', label: 'IS NULL' },
  { value: 'is_not_null', label: 'IS NOT NULL' }
]

export const OPERATOR_VALUE_KIND: Record<FilterOperator, OperatorValueKind> = {
  '=': 'single',
  '<>': 'single',
  '<': 'single',
  '>': 'single',
  '<=': 'single',
  '>=': 'single',
  contains: 'single',
  not_contains: 'single',
  in: 'list',
  between: 'two',
  is_null: 'none',
  is_not_null: 'none'
}
