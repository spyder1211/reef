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

  it('パラメータ化クエリで ? が値に置換される', async () => {
    const res = await mgr.query('SELECT ? AS v', ['hello'])
    expect(res.rows[0]).toEqual({ v: 'hello' })
  })

  it('フィルタ相当: WHERE のプレースホルダに params を束縛する（ユーザー報告の再現）', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS pq_demo (id INT, car_type INT)')
    await mgr.query('DELETE FROM pq_demo')
    await mgr.query('INSERT INTO pq_demo (id, car_type) VALUES (1, 2), (2, 3)')
    const res = await mgr.query('SELECT * FROM `pq_demo` WHERE `car_type` = ? LIMIT 100', ['2'])
    expect(res.rowCount).toBe(1)
    expect(res.rows[0]).toMatchObject({ id: 1, car_type: 2 })
  })

  it('dateStrings: DATETIME/DATE を保存文字列のまま返す（Date オブジェクトにしない）', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS ts_demo (id INT, created_at DATETIME, d DATE)')
    await mgr.query('DELETE FROM ts_demo')
    await mgr.query("INSERT INTO ts_demo (id, created_at, d) VALUES (1, '2025-09-26 16:17:05', '2025-09-26')")
    const res = await mgr.query('SELECT created_at, d FROM ts_demo WHERE id = 1')
    expect(res.rows[0].created_at).toBe('2025-09-26 16:17:05')
    expect(res.rows[0].d).toBe('2025-09-26')
  })

  it('ORDER BY + LIMIT/OFFSET と COUNT(*) がページング用に正しく動く', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS pg_demo (id INT, n INT)')
    await mgr.query('DELETE FROM pg_demo')
    await mgr.query('INSERT INTO pg_demo (id, n) VALUES (1,10),(2,20),(3,30),(4,40),(5,50)')

    // n 降順 = 50,40,30,20,10。2 ページ目（OFFSET 2 LIMIT 2）→ 30,20
    const page = await mgr.query('SELECT n FROM `pg_demo` ORDER BY `n` DESC LIMIT 2 OFFSET 2')
    expect(page.rows.map((r) => r.n)).toEqual([30, 20])

    const count = await mgr.query('SELECT COUNT(*) AS total FROM `pg_demo`')
    expect(Number(count.rows[0].total)).toBe(5)
  })

  it('primaryKey: 主キー列を返す / 主キーなしは空配列', async () => {
    await mgr.query('DROP TABLE IF EXISTS pk_demo')
    await mgr.query('CREATE TABLE pk_demo (id INT PRIMARY KEY, name VARCHAR(50))')
    expect(await mgr.primaryKey('pk_demo')).toEqual(['id'])
    await mgr.query('DROP TABLE IF EXISTS nopk_demo')
    await mgr.query('CREATE TABLE nopk_demo (a INT, b INT)')
    expect(await mgr.primaryKey('nopk_demo')).toEqual([])
  })

  it('primaryKey: 複合主キーを Seq_in_index 順で返す', async () => {
    await mgr.query('DROP TABLE IF EXISTS cpk_demo')
    await mgr.query('CREATE TABLE cpk_demo (a INT, b INT, PRIMARY KEY (a, b))')
    expect(await mgr.primaryKey('cpk_demo')).toEqual(['a', 'b'])
  })

  it('applyChanges: 複数 UPDATE をトランザクションで適用', async () => {
    await mgr.query('DROP TABLE IF EXISTS ac_demo')
    await mgr.query('CREATE TABLE ac_demo (id INT PRIMARY KEY, n INT)')
    await mgr.query('INSERT INTO ac_demo (id, n) VALUES (1,10),(2,20)')
    const res = await mgr.applyChanges([
      { sql: 'UPDATE `ac_demo` SET `n` = ? WHERE `id` = ?', params: [11, 1] },
      { sql: 'UPDATE `ac_demo` SET `n` = ? WHERE `id` = ?', params: [22, 2] }
    ])
    expect(res.affectedRows).toBe(2)
    const after = await mgr.query('SELECT n FROM ac_demo ORDER BY id')
    expect(after.rows.map((r) => r.n)).toEqual([11, 22])
  })

  it('applyChanges: 1文でも失敗すると全ロールバック', async () => {
    await mgr.query('DROP TABLE IF EXISTS ac_rollback')
    await mgr.query('CREATE TABLE ac_rollback (id INT PRIMARY KEY, n INT NOT NULL)')
    await mgr.query('INSERT INTO ac_rollback (id, n) VALUES (1,10)')
    await expect(
      mgr.applyChanges([
        { sql: 'UPDATE `ac_rollback` SET `n` = ? WHERE `id` = ?', params: [99, 1] },
        { sql: 'UPDATE `ac_rollback` SET `n` = ? WHERE `id` = ?', params: [null, 1] }
      ])
    ).rejects.toMatchObject({ code: 'ER_BAD_NULL_ERROR' })
    const after = await mgr.query('SELECT n FROM ac_rollback WHERE id = 1')
    expect(after.rows[0].n).toBe(10)
  })
})
