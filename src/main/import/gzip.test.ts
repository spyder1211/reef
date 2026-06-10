import { describe, it, expect } from 'vitest'
import { isGzipMagic } from './gzip'

describe('isGzipMagic', () => {
  it('gzip マジックバイト 0x1f 0x8b で始まる Buffer は true', () => {
    expect(isGzipMagic(Buffer.from([0x1f, 0x8b, 0x08, 0x00]))).toBe(true)
  })

  it('テキスト（SQL）は false', () => {
    expect(isGzipMagic(Buffer.from('SELECT 1'))).toBe(false)
  })

  it('1バイトだけ（0x1f）は false', () => {
    expect(isGzipMagic(Buffer.from([0x1f]))).toBe(false)
  })

  it('空 Buffer は false', () => {
    expect(isGzipMagic(Buffer.alloc(0))).toBe(false)
  })

  it('2バイト目が 0x8b でなければ false', () => {
    expect(isGzipMagic(Buffer.from([0x1f, 0x00]))).toBe(false)
  })
})
