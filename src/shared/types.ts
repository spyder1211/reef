// main / preload / renderer すべてで共有する型
export interface ConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database?: string
}

export interface QueryColumn {
  name: string
}

export interface QueryResult {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
}

export interface AppError {
  code: string
  message: string
}

// IPC の戻り値は例外を投げず、必ずこの判別共用体で返す
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }
