// テスト環境のグローバル window に最小限の i18n スタブを設定する。
// useAppStore がモジュールロード時に window.api.i18n.bootstrap を読むため、
// 静的 import を使う既存テストファイルでも window が定義されている必要がある。
// 各テストファイルの vi.stubGlobal('window', ...) は個別のテスト内でこれを上書きする。
import { vi } from 'vitest'

vi.stubGlobal('window', {
  api: {
    i18n: {
      bootstrap: { systemLocale: 'en', preference: 'auto', effective: 'en' },
      setLocale: async () => ({ effective: 'en' as const })
    }
  }
})
