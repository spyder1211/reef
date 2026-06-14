import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { CSP } from './src/shared/csp'

// バージョン表示が陳腐化しないよう、ビルド時に package.json から取り込む。
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

// 本番ビルドの index.html にだけ CSP の <meta> を注入する。
// main 側の onHeadersReceived は file:// ロードで発火しない環境があるため、meta 併用で確実に効かせる。
// apply: 'build' により dev（Vite HMR）には注入されない。
function cspMetaPlugin(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          // head の先頭に置く。meta CSP は「それより後ろ」のリソースにしか効かないため、
          // Vite が注入するバンドル <script> より前に来る必要がある。
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), cspMetaPlugin()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) }
  }
})
