// 循環インデックス。フォーカストラップ(Tab)とメニューの↑↓ローブイングで共用。
// count<=0 のときは 0 を返す（安全側）。
export function wrapIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return 0
  return (((current + delta) % count) + count) % count
}
