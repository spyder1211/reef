/// <reference types="vite/client" />

import type { Api } from '../../preload'

declare global {
  // electron.vite.config.ts の define で package.json の version を埋め込む。
  const __APP_VERSION__: string

  interface Window {
    api: Api
  }
}
