// SSH トンネル設定。enabled=false なら他フィールドは無視される。
export interface SshSettings {
  enabled: boolean
  host: string
  port: number // 既定 22
  user: string
  authMethod: 'password' | 'privateKey'
  password?: string // authMethod=password 時。保存時は暗号化される
  privateKeyPath?: string // authMethod=privateKey 時の鍵ファイルパス
  passphrase?: string // 鍵のパスフレーズ。保存時は暗号化される
}

// renderer へ返す形（秘匿値 password/passphrase を含めない）。
export type SshSettingsPublic = Omit<SshSettings, 'password' | 'passphrase'>

// main / preload / renderer すべてで共有する型
export interface ConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database?: string
  ssh?: SshSettings // SSH トンネル経由で接続する場合のみ
}

export interface QueryColumn {
  name: string
  type?: string // mysql2 のフィールド型名（例: longlong / var_string / timestamp）。未取得は undefined
}

export interface QueryResult {
  columns: QueryColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  durationMs: number
  autoLimited?: boolean // 単一素SELECTに自動 LIMIT 500 を付与した（SQLタブのみ）
  truncated?: boolean // 結果が MAX_RESULT_ROWS を超えたため打ち切った（SQLタブのみ）
}

export interface AppError {
  code: string
  message: string
  // renderer TranslationKey — present when the message originates from a client-side translation.
  // Display components should prefer t(messageKey) over the stored message string so that
  // the displayed text follows locale switches without re-running the store action.
  messageKey?: string
}

// IPC の戻り値は例外を投げず、必ずこの判別共用体で返す
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError }

// 接続プロファイル（保存済み接続）
export type ConnectionTag = 'production' | 'staging' | 'development' | 'local' | 'none'

// 接続グループ（上位グループ）。環境サブグループは tag から導出するため保存しない
export interface ConnectionGroup {
  id: string
  name: string
  order: number // 並び替え用。小さいほど上に表示
}

// レンダラに渡す形（パスワードは含めない）
export interface ConnectionProfile {
  id: string
  name: string
  tag: ConnectionTag
  host: string
  port: number
  user: string
  database?: string
  groupId?: string // 所属グループ。未設定 = 未分類
  ssh?: SshSettingsPublic // SSH 設定（秘匿値は含めない）
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
  groupId?: string // 通常フォームからは送らない。DnD/move 経由で設定
  ssh?: SshSettings // SSH 設定（password/passphrase を含む。保存時に暗号化）
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

// INSERT ステージング中の1行
export interface PendingInsert {
  localId: string                       // ローカル一意 ID（"ins-0", "ins-1" …）
  values: Record<string, string | null> // 列名 → 入力値（空文字は SQL から除外）
}

// ファイル保存ダイアログの結果
export interface SaveFileResult {
  canceled: boolean
  filePath?: string
}

// SQL dump import / restore の実行結果サマリ
export interface ImportSummary {
  status: 'completed' | 'failed'
  executedCount: number // 成功実行できた statement 数
  durationMs: number
  failure?: {
    statementIndex: number // 1始まり：失敗した statement の番号
    statementPreview: string // 該当 statement の先頭 N 文字
    message: string // DB エラーメッセージ
  }
}

// import 実行中に main → renderer へ push する進捗
export interface ImportProgress {
  executedCount: number
  bytesRead: number
  totalBytes: number
  currentPreview?: string // 実行中/直近 statement の先頭
}

// File メニューでファイル選択後、main → renderer へ送る開始要求
export interface SqlImportRequest {
  fileName: string
  totalBytes: number
  dbName: string
}

// テーブル構造表示（Structure ビュー）用のスキーマ情報
export interface SchemaColumn {
  name: string
  type: string // SHOW FULL COLUMNS の Type（例: "varchar(255)", "int unsigned"）
  nullable: boolean
  key: string // 'PRI' | 'UNI' | 'MUL' | ''
  default: string | null
  extra: string // auto_increment / on update CURRENT_TIMESTAMP 等
  comment: string
}

export interface SchemaIndex {
  name: string
  columns: string[] // Seq_in_index 順
  unique: boolean
}

export interface TableSchema {
  columns: SchemaColumn[]
  indexes: SchemaIndex[]
  ddl: string // SHOW CREATE TABLE の結果
}

// クエリ履歴の1エントリ（main 側で userData に永続化）
export interface QueryHistoryEntry {
  id: string
  sql: string
  executedAt: string // ISO 8601
  durationMs: number
  ok: boolean
  errorMessage?: string
  database?: string // 実行時の接続先 DB 名
}
