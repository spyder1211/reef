// 値が JSON のオブジェクト/配列なら 2 スペースインデントで整形して返す。
// プリミティブや非 JSON は null（整形表示の対象外）。
export function tryFormatJson(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}
