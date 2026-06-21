import { describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from './ConnectionManager'

// private な pool にフェイクを差し込んで withDedicatedConnection を検証する。
function withFakePool(): {
  mgr: ConnectionManager
  conn: {
    query: ReturnType<typeof vi.fn>
    release: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
} {
  const conn = {
    query: vi.fn().mockResolvedValue([{}, []]),
    release: vi.fn(),
    destroy: vi.fn()
  }
  const fakePool = { getConnection: vi.fn().mockResolvedValue(conn) }
  const mgr = new ConnectionManager()
  ;(mgr as unknown as { pool: unknown }).pool = fakePool
  return { mgr, conn }
}

describe('ConnectionManager.withDedicatedConnection', () => {
  it('未接続なら throw する', async () => {
    const mgr = new ConnectionManager()
    await expect(mgr.withDedicatedConnection(async () => 0)).rejects.toThrow('Not connected')
  })

  it('exec が同一接続で query を呼び、正常終了で release する', async () => {
    const { mgr, conn } = withFakePool()
    const result = await mgr.withDedicatedConnection(async (exec) => {
      await exec('SELECT 1')
      await exec('SELECT 2')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(conn.query).toHaveBeenCalledTimes(2)
    expect(conn.query).toHaveBeenNthCalledWith(1, 'SELECT 1')
    expect(conn.release).toHaveBeenCalledTimes(1)
    expect(conn.destroy).not.toHaveBeenCalled()
  })

  it('fn が throw したら接続を destroy して再 throw する', async () => {
    const { mgr, conn } = withFakePool()
    await expect(
      mgr.withDedicatedConnection(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(conn.destroy).toHaveBeenCalledTimes(1)
    expect(conn.release).not.toHaveBeenCalled()
  })
})
