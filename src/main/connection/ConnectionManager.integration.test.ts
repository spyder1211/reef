import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ConnectionManager } from './ConnectionManager'

const hasDb = !!process.env.TEST_MYSQL_HOST
const cfg = {
  host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_MYSQL_PORT ?? 13306),
  user: process.env.TEST_MYSQL_USER ?? 'root',
  password: process.env.TEST_MYSQL_PASSWORD ?? 'rootpw',
  database: process.env.TEST_MYSQL_DATABASE ?? 'testdb'
}

describe.skipIf(!hasDb)('ConnectionManager (integration)', () => {
  const mgr = new ConnectionManager()
  beforeAll(async () => { await mgr.connect(cfg) })
  afterAll(async () => { await mgr.disconnect() })

  it('SELECT 1 が実行でき、行と列が返る', async () => {
    const res = await mgr.query('SELECT 1 AS one')
    expect(res.rows[0]).toEqual({ one: 1 })
    expect(res.columns.map((c) => c.name)).toContain('one')
    expect(res.rowCount).toBe(1)
    expect(res.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('不正な SQL は例外を投げる', async () => {
    await expect(mgr.query('SELECT * FROM no_such_table')).rejects.toMatchObject({
      code: 'ER_NO_SUCH_TABLE'
    })
  })

  it('listTables でテーブル名一覧が返る', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS lt_demo (id INT)')
    const tables = await mgr.listTables()
    expect(tables).toContain('lt_demo')
  })
})
