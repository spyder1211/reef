// 右クリック座標とメニュー実寸から、ビューポート内に収まる {top,left} を返す。
// 右端/下端を超える場合はアンカーから左/上へフリップし、なお収まらなければ margin でクランプ。
export function clampMenuPosition(
  anchor: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 4
): { top: number; left: number } {
  const axis = (start: number, size: number, limit: number): number => {
    let v = start
    if (v + size > limit - margin) v = start - size // フリップ
    if (v < margin) v = margin // クランプ（フリップしても入らない場合）
    const max = limit - size - margin
    if (max >= margin && v > max) v = max
    return v
  }
  return {
    top: axis(anchor.y, menu.height, viewport.height),
    left: axis(anchor.x, menu.width, viewport.width)
  }
}
