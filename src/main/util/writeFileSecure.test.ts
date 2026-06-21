import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileSecure } from './writeFileSecure'

describe('writeFileSecure', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfs-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('新規ファイルを 0o600 で書く', () => {
    const p = join(dir, 'a.json')
    writeFileSecure(p, '{"x":1}')
    expect(existsSync(p)).toBe(true)
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })

  it('既存ファイル（0o644）を上書きしても 0o600 になる', () => {
    const p = join(dir, 'b.json')
    writeFileSync(p, 'old', { mode: 0o644 })
    writeFileSecure(p, 'new')
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })

  it('内容が正しく書かれる', () => {
    const p = join(dir, 'c.json')
    writeFileSecure(p, 'hello')
    expect(readFileSync(p, 'utf-8')).toBe('hello')
  })
})
