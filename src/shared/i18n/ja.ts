import type { TranslationKey } from './index'

export const ja: Record<TranslationKey, string> = {
  'common.cancel': 'キャンセル',
  'common.execute': '実行',
  'home.newConnection': '新規接続',
  'home.settings': '設定',
  'home.searchConnections': '接続を検索…',
  'menu.file': 'File',
  'menu.exportSqlDump': 'SQLダンプをエクスポート…',
  'workspace.filterActive.one': 'フィルタ {count} 件 適用中',
  'workspace.filterActive.other': 'フィルタ {count} 件 適用中',
  'menu.importSqlDump': 'SQLダンプをインポート / リストア…',
  'menu.reload': '再読み込み',
  'menu.view': 'View',
  'dialog.notConnected.message': 'DB に接続していません',
  'dialog.notConnected.exportDetail': '接続してから SQL ダンプを実行してください。',
  'dialog.notConnected.importDetail': '接続してから SQL ダンプを import してください。',
  'dialog.dumpSaved.message': 'SQL ダンプを保存しました',
  'dialog.dumpSaved.detail': '{path}\n{tables} テーブル / {rows} 行',
  'dialog.dumpFailed.message': 'SQL ダンプに失敗しました',
  'dialog.dumpFailed.detail': '{message}\n部分的に書き込まれたファイルが残っている可能性があります。'
}
