import { chmodSync, renameSync, writeFileSync } from 'node:fs'

// 所有者のみ読み書き可（0o600）で、かつアトミックにファイルを書き込む。
// - 一時ファイルへ 0o600 で書いてから renameSync で置換する。これにより
//   (a) 書き込み途中クラッシュで本体が壊れない（rename は同一FS上でアトミック）、
//   (b) 既存ファイルへ writeFileSync すると旧 mode（例 0o644）のまま秘匿内容が一瞬乗る窓を無くす。
// - writeFileSync の mode は新規作成時しか効かないため、一時ファイルが万一既存でも chmodSync で締める。
export function writeFileSecure(path: string, data: string): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}
