// electron-builder の afterPack フック。
//
// 二経路構成:
//  - 未署名モード（APPLE_IDENTITY なし）= 従来通り。identity: null だと electron-builder は
//    署名を完全にスキップし、リンカ由来の最小 ad-hoc 署名しか残らず（Sealed Resources=none /
//    Info.plist=not bound）、配布先で「壊れているため開けません」と拒否される。ここでバンドル
//    全体を ad-hoc 署名し直してリソースを封印し、エラーを「未確認の開発者」に緩和する。
//  - 正規署名モード（APPLE_IDENTITY あり）= release:mac。electron-builder が Developer ID で
//    正規署名するため、ここでの ad-hoc 署名は不要（むしろ邪魔）。スキップする。
const { execFileSync } = require('child_process')
const path = require('path')

// APPLE_IDENTITY がセットされていれば正規署名モード。ad-hoc 署名を行わない。
function shouldSkipAdhocSign(env) {
  return Boolean(env.APPLE_IDENTITY)
}

exports.shouldSkipAdhocSign = shouldSkipAdhocSign

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (shouldSkipAdhocSign(process.env)) return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // 入れ子の Helper / Framework も含めて ad-hoc 署名（--deep）し、メインバンドルを封印する。
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
