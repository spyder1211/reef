// MySQL 識別子をバッククォートで囲み、内部のバッククォートを2重化してエスケープする
// （SQLi 防御の単一管理）。値プレースホルダではなく、テーブル名・カラム名など識別子の埋め込み専用。
export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}
