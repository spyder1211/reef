import { writeFileSync, chmodSync } from 'node:fs'

// 所有者のみ読み書き可（0o600）でファイルを書き込む。
// writeFileSync の mode は新規作成時しか効かないため、既存ファイルにも chmodSync で適用する。
export function writeFileSecure(path: string, data: string): void {
  writeFileSync(path, data, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(path, 0o600)
}
