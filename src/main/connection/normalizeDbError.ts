import type { AppError } from '../../shared/types'

export function normalizeDbError(err: unknown): AppError {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string; sqlMessage?: string }
    return {
      code: e.code ?? 'UNKNOWN',
      message: e.sqlMessage ?? e.message ?? 'Unknown database error'
    }
  }
  return { code: 'UNKNOWN', message: String(err) }
}
