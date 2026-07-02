import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { shouldSkipAdhocSign } = require('./afterPack.cjs') as {
  shouldSkipAdhocSign: (env: NodeJS.ProcessEnv) => boolean
}

describe('shouldSkipAdhocSign', () => {
  it('正規署名モード（APPLE_IDENTITY あり）は ad-hoc をスキップする', () => {
    expect(shouldSkipAdhocSign({ APPLE_IDENTITY: 'Developer ID Application: X (TEAMID)' })).toBe(true)
  })

  it('未署名モード（APPLE_IDENTITY なし）は ad-hoc 署名する', () => {
    expect(shouldSkipAdhocSign({})).toBe(false)
  })

  it('空文字の APPLE_IDENTITY は未署名扱い', () => {
    expect(shouldSkipAdhocSign({ APPLE_IDENTITY: '' })).toBe(false)
  })
})
