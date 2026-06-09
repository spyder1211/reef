// File メニュー（ファイル選択）と IPC ハンドラ（実行）の間で共有する状態。
// renderer から任意パスを注入させないため、main 側が選んだパスのみを保持・消費する。

let pendingImportPath: string | null = null
let importing = false

export function setPendingImport(path: string): void {
  pendingImportPath = path
}

// 保留中のパスを返し、内部状態はクリアする（1 回のみ消費可能）。
export function consumePendingImport(): string | null {
  const p = pendingImportPath
  pendingImportPath = null
  return p
}

export function isImporting(): boolean {
  return importing
}

export function setImporting(v: boolean): void {
  importing = v
}
