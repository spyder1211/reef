import type { FilterOperator } from '../../../shared/types'

export type OperatorValueKind = 'none' | 'single' | 'two' | 'list'

export interface OperatorMeta {
  value: FilterOperator
  label: string
}

export const OPERATORS: OperatorMeta[] = [
  { value: '=', label: '=' },
  { value: '<>', label: '≠' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '<=', label: '≤' },
  { value: '>=', label: '≥' },
  { value: 'contains', label: '含む' },
  { value: 'not_contains', label: '含まない' },
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
