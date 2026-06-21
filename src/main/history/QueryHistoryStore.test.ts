import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryHistoryStore } from './QueryHistoryStore'

describe('QueryHistoryStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qh-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('add した履歴を新しい順で list できる', () => {
    const store = new QueryHistoryStore(dir)
    store.add({ sql: 'SELECT 1', durationMs: 5, ok: true, database: 'test' })
    store.add({ sql: 'SELECT 2', durationMs: 7, ok: true, database: 'test' })
    const list = store.list()
    expect(list).toHaveLength(2)
    expect(list[0].sql).toBe('SELECT 2') // 新しい順
    expect(list[0].id).toBeTruthy()
    expect(list[0].executedAt).toBeTruthy()
  })

  it('上限 500 件を超えると古いものから捨てる', () => {
    const store = new QueryHistoryStore(dir)
    for (let i = 0; i < 510; i++) store.add({ sql: `SELECT ${i}`, durationMs: 1, ok: true })
    const list = store.list()
    expect(list).toHaveLength(500)
    expect(list[0].sql).toBe('SELECT 509')
    expect(list[499].sql).toBe('SELECT 10')
  })

  it('別インスタンスで読み直せる（永続化）', () => {
    new QueryHistoryStore(dir).add({ sql: 'SELECT 1', durationMs: 5, ok: true })
    expect(new QueryHistoryStore(dir).list()).toHaveLength(1)
  })

  it('clear で全削除できる', () => {
    const store = new QueryHistoryStore(dir)
    store.add({ sql: 'SELECT 1', durationMs: 5, ok: true })
    store.clear()
    expect(store.list()).toHaveLength(0)
  })

  it('履歴ファイルを 0o600 で書く', () => {
    const store = new QueryHistoryStore(dir)
    store.add({ sql: 'SELECT 1', durationMs: 5, ok: true })
    const p = join(dir, 'query-history.json')
    expect(statSync(p).mode & 0o777).toBe(0o600)
  })
})
