// electron-builder の afterPack フック。
//
// 二経路構成:
//  - 未署名モード（REEF_SIGN なし）= dist:mac・開発ビルド。identity: null だと electron-builder は
//    署名を完全にスキップし、リンカ由来の最小 ad-hoc 署名しか残らず（Sealed Resources=none /
//    Info.plist=not bound）、配布先で「壊れているため開けません」と拒否される。ここでバンドル全体を
//    ad-hoc 署名し直してリソースを封印し、エラーを「未確認の開発者」に緩和する。
//  - 正規署名モード（REEF_SIGN=1）= release:mac。electron-builder が Developer ID で正規署名するため、
//    ここでの ad-hoc 署名は不要（むしろ邪魔）。スキップする。
//
// 判定は release:mac だけがセットする REEF_SIGN を見る（ambient な APPLE_IDENTITY ではない）。これにより
// release.env を source 済みのシェルで dist:mac を実行しても REEF_SIGN は未設定なので正しく ad-hoc
// 署名され、「壊れた」バンドルが無言で生成されることを防ぐ。
const { execFileSync } = require('child_process')
const path = require('path')

// REEF_SIGN がセットされていれば正規署名モード（release:mac）。ad-hoc 署名を行わない。
function shouldSkipAdhocSign(env) {
  return Boolean(env.REEF_SIGN)
}

exports.shouldSkipAdhocSign = shouldSkipAdhocSign

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (shouldSkipAdhocSign(process.env)) return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // 入れ子の Helper / Framework も含めて ad-hoc 署名（--deep）し、メインバンドルを封印する。
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
