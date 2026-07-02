import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { shouldSkipAdhocSign } = require('./afterPack.cjs') as {
  shouldSkipAdhocSign: (env: NodeJS.ProcessEnv) => boolean
}

describe('shouldSkipAdhocSign', () => {
  it('正規署名モード（REEF_SIGN あり）は ad-hoc をスキップする', () => {
    expect(shouldSkipAdhocSign({ REEF_SIGN: '1' })).toBe(true)
  })

  it('未署名モード（REEF_SIGN なし）は ad-hoc 署名する', () => {
    expect(shouldSkipAdhocSign({})).toBe(false)
  })

  it('空文字の REEF_SIGN は未署名扱い', () => {
    expect(shouldSkipAdhocSign({ REEF_SIGN: '' })).toBe(false)
  })

  it('APPLE_IDENTITY だけでは ad-hoc をスキップしない（release.env を source したシェルで dist:mac を走らせても壊れない）', () => {
    expect(shouldSkipAdhocSign({ APPLE_IDENTITY: 'Developer ID Application: X (TEAMID)' })).toBe(false)
  })
})
