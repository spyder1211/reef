// electron-builder の afterPack フック。
//
// identity: null だと electron-builder は署名を完全にスキップするため、リンカが付ける
// 最小限の ad-hoc 署名しか残らず（Sealed Resources=none / Info.plist=not bound）、
// 配布先で quarantine と相まって「壊れているため開けません」と Gatekeeper に拒否される。
//
// ここでバンドル全体を ad-hoc 署名し直してリソースを封印する。これにより配布先での
// エラーが「壊れている」→「未確認の開発者」に緩和され、右クリック→開くで起動できる。
// （Apple Developer 証明書での署名・公証ではないため、ダブルクリック一発の起動には未対応）
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // 入れ子の Helper / Framework も含めて ad-hoc 署名（--deep）し、メインバンドルを封印する。
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
