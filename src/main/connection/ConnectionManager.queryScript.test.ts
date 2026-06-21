import { describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from './ConnectionManager'

// private な pool に query だけ持つフェイクを差し込んで queryScript を検証する。
// impl(sql) が mysql2 の [rows, fields] タプルを返す。
function withQueryPool(impl: (sql: string) => [unknown, unknown]): {
  mgr: ConnectionManager
  query: ReturnType<typeof vi.fn>
} {
  const query = vi.fn(async (sql: string) => impl(sql))
  const mgr = new ConnectionManager()
  ;(mgr as unknown as { pool: unknown }).pool = { query }
  return { mgr, query }
}

describe('ConnectionManager.queryScript', () => {
  it('未接続なら throw する', async () => {
    const mgr = new ConnectionManager()
    await expect(mgr.queryScript('SELECT 1')).rejects.toThrow('Not connected')
  })

  it('; で分割して順に実行し、最後の文の結果を返す', async () => {
    const { mgr, query } = withQueryPool((sql) =>
      sql.includes('b') ? [[{ b: 2 }], [{ name: 'b' }]] : [[{ a: 1 }], [{ name: 'a' }]]
    )
    const res = await mgr.queryScript('SELECT 1 AS a; SELECT 2 AS b;')
    expect(query).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenNthCalledWith(1, 'SELECT 1 AS a', undefined)
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT 2 AS b', undefined)
    expect(res.rows).toEqual([{ b: 2 }])
    expect(res.columns).toEqual([{ name: 'b', type: undefined }])
    expect(res.rowCount).toBe(1)
  })

  it('空入力・コメントのみは実行せず空結果を返す', async () => {
    const { mgr, query } = withQueryPool(() => [[], []])
    const res = await mgr.queryScript('  -- just a comment\n')
    expect(query).not.toHaveBeenCalled()
    expect(res).toEqual({ columns: [], rows: [], rowCount: 0, durationMs: 0 })
  })

  it('単一の素SELECTには LIMIT 500 を付けて実行し autoLimited=true', async () => {
    const { mgr, query } = withQueryPool(() => [[{ a: 1 }], [{ name: 'a' }]])
    const res = await mgr.queryScript('SELECT 1 AS a')
    expect(query).toHaveBeenCalledWith('SELECT 1 AS a LIMIT 500', undefined)
    expect(res.autoLimited).toBe(true)
  })

  it('skipAutoLimit=true なら LIMIT を付けない', async () => {
    const { mgr, query } = withQueryPool(() => [[{ a: 1 }], [{ name: 'a' }]])
    const res = await mgr.queryScript('SELECT 1 AS a', undefined, { skipAutoLimit: true })
    expect(query).toHaveBeenCalledWith('SELECT 1 AS a', undefined)
    expect(res.autoLimited).toBeUndefined()
  })

  it('結果が MAX_RESULT_ROWS を超えたら打ち切り truncated=true', async () => {
    const big = Array.from({ length: 10001 }, (_v, i) => ({ id: i }))
    const { mgr } = withQueryPool(() => [big, [{ name: 'id' }]])
    // 明示LIMITありにして自動LIMITを回避し、ハード上限のみ効かせる
    const res = await mgr.queryScript('SELECT id FROM t LIMIT 100000')
    expect(res.rowCount).toBe(10000)
    expect(res.rows).toHaveLength(10000)
    expect(res.truncated).toBe(true)
  })
})
