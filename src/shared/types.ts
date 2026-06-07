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

// 接続プロファイル（保存済み接続）
export type ConnectionTag = 'production' | 'staging' | 'development' | 'local' | 'none'

// レンダラに渡す形（パスワードは含めない）
export interface ConnectionProfile {
  id: string
  name: string
  tag: ConnectionTag
  host: string
  port: number
  user: string
  database?: string
}

// 保存・更新の入力（パスワードを含む。保存後はメインのみが暗号化保持）
export interface ConnectionProfileInput {
  id?: string
  name: string
  tag: ConnectionTag
  host: string
  port: number
  user: string
  password: string
  database?: string
}

// フィルター条件
export type FilterOperator =
  | '=' | '<>' | '<' | '>' | '<=' | '>='
  | 'is_null' | 'is_not_null'
  | 'contains' | 'not_contains'
  | 'in' | 'between'

export interface FilterCondition {
  id: string
  enabled: boolean
  column: string
  operator: FilterOperator
  value: string // 主値（between は下限 / in はカンマ区切りリスト）
  value2: string // between の上限のみ使用
}

// テーブルビューのソート状態
export type SortDir = 'asc' | 'desc'
export interface TableSort {
  column: string
  dir: SortDir
}

// 1行分のステージング中の編集（UPDATE 用）
export interface RowEdit {
  pk: Record<string, unknown> // オリジナル行の主キー列 → 値（WHERE 用）
  values: Record<string, string | null> // 変更された列 → 新しい値（SET 用）
}

// パラメータ化された 1 文（IPC で main に渡してトランザクション実行する）
export interface SqlStatement {
  sql: string
  params: unknown[]
}
