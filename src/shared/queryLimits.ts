// SQLタブの結果サイズ制御。設定UIが無いため定数で固定（将来の設定化に備える）。
export const DEFAULT_SQL_LIMIT = 500 // 単一の素SELECTに自動付与するソフトLIMIT
export const MAX_RESULT_ROWS = 10000 // IPC転送のハード上限。超過分は打ち切る
