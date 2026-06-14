// レンダラに適用する Content-Security-Policy。
// 本番では二重で適用する:
//   (1) main の session.onHeadersReceived による HTTP ヘッダ
//   (2) ビルド時に index.html へ注入する <meta http-equiv> タグ（electron.vite.config.ts）
// file:// ロードでは onHeadersReceived が発火しない環境があるため、meta 併用で確実に効かせる。
// （いずれも同一文字列なのでブラウザは矛盾なく両方を適用する）
//
// script-src 'self'（unsafe-inline/eval なし）が最重要の防御。
// style は React/CodeMirror のインラインスタイル用に 'unsafe-inline' を許可（script より低リスク）。
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'"
