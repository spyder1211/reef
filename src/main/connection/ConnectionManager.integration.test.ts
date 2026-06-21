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
  beforeAll(async () => {
    await mgr.connect(cfg)
  })
  afterAll(async () => {
    await mgr.disconnect()
  })

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
    await mgr.query(
      "INSERT INTO ts_demo (id, created_at, d) VALUES (1, '2025-09-26 16:17:05', '2025-09-26')"
    )
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

  it('query は columns に mysql2 の型名を付与する', async () => {
    await mgr.query('DROP TABLE IF EXISTS type_demo')
    await mgr.query('CREATE TABLE type_demo (id INT, name VARCHAR(50), created_at TIMESTAMP NULL)')
    const res = await mgr.query('SELECT id, name, created_at FROM type_demo')
    const byName = Object.fromEntries(res.columns.map((c) => [c.name, c.type]))
    expect(byName.id).toBe('long')
    expect(byName.name).toBe('var_string')
    expect(byName.created_at).toBe('timestamp')
  })

  it('applyChanges: INSERT で行が増える', async () => {
    await mgr.query('DROP TABLE IF EXISTS ins_demo')
    await mgr.query('CREATE TABLE ins_demo (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50))')
    const res = await mgr.applyChanges([
      { sql: 'INSERT INTO `ins_demo` (`name`) VALUES (?)', params: ['太郎'] },
      { sql: 'INSERT INTO `ins_demo` (`name`) VALUES (?)', params: ['花子'] }
    ])
    expect(res.affectedRows).toBe(2)
    const after = await mgr.query('SELECT name FROM ins_demo ORDER BY id')
    expect(after.rows.map((r) => r.name)).toEqual(['太郎', '花子'])
  })

  it('applyChanges: DELETE で行が減る', async () => {
    await mgr.query('DROP TABLE IF EXISTS del_demo')
    await mgr.query('CREATE TABLE del_demo (id INT PRIMARY KEY, name VARCHAR(50))')
    await mgr.query('INSERT INTO del_demo (id, name) VALUES (1, "A"), (2, "B"), (3, "C")')
    const res = await mgr.applyChanges([
      { sql: 'DELETE FROM `del_demo` WHERE `id` = ?', params: [2] }
    ])
    expect(res.affectedRows).toBe(1)
    const after = await mgr.query('SELECT id FROM del_demo ORDER BY id')
    expect(after.rows.map((r) => r.id)).toEqual([1, 3])
  })

  it('applyChanges: DELETE + UPDATE + INSERT の混合が1トランザクションで適用される', async () => {
    await mgr.query('DROP TABLE IF EXISTS mix_demo')
    await mgr.query('CREATE TABLE mix_demo (id INT PRIMARY KEY, name VARCHAR(50))')
    await mgr.query('INSERT INTO mix_demo (id, name) VALUES (1, "A"), (2, "B")')
    await mgr.applyChanges([
      { sql: 'DELETE FROM `mix_demo` WHERE `id` = ?', params: [1] },
      { sql: 'UPDATE `mix_demo` SET `name` = ? WHERE `id` = ?', params: ['BB', 2] },
      { sql: 'INSERT INTO `mix_demo` (id, name) VALUES (?, ?)', params: [3, 'C'] }
    ])
    const after = await mgr.query('SELECT id, name FROM mix_demo ORDER BY id')
    expect(after.rows).toEqual([
      { id: 2, name: 'BB' },
      { id: 3, name: 'C' }
    ])
  })

  it('applyChanges: 途中で失敗したら全ロールバック（先行 INSERT も適用されない）', async () => {
    await mgr.query('DROP TABLE IF EXISTS mix_rb')
    await mgr.query('CREATE TABLE mix_rb (id INT PRIMARY KEY, n INT NOT NULL)')
    await mgr.query('INSERT INTO mix_rb (id, n) VALUES (1, 10)')
    await expect(
      mgr.applyChanges([
        { sql: 'INSERT INTO `mix_rb` (id, n) VALUES (?, ?)', params: [2, 20] },
        { sql: 'UPDATE `mix_rb` SET `n` = ? WHERE `id` = ?', params: [null, 1] }
      ])
    ).rejects.toMatchObject({ code: 'ER_BAD_NULL_ERROR' })
    const after = await mgr.query('SELECT id FROM mix_rb ORDER BY id')
    expect(after.rows.map((r) => r.id)).toEqual([1])
  })

  it('cancel: 実行中クエリを速やかに中断し、接続は再利用できる', async () => {
    const started = Date.now()
    const p = mgr.query('SELECT SLEEP(10) AS s', [], 'cancel-1')
    // クエリがサーバに届き runningQueries に登録されるまで少し待つ
    await new Promise((r) => setTimeout(r, 500))
    await mgr.cancel('cancel-1')
    // 中断されるので 10 秒待たずに settle する（SLEEP は 1 を返す/重い文は 1317 で reject、どちらも可）
    await p.catch(() => undefined)
    expect(Date.now() - started).toBeLessThan(5000)
    // KILL QUERY は接続を殺さないので後続クエリが通る
    const r = await mgr.query('SELECT 1 AS one', [], 'cancel-2')
    expect(Number(r.rows[0]?.one)).toBe(1)
  }, 15000)

  it('cancel: 実行中でない tabId は no-op（reject しない）', async () => {
    await expect(mgr.cancel('no-such-tab')).resolves.toBeUndefined()
  })

  it('SQLタブ: 単一の素SELECTは自動 LIMIT 500 が効き autoLimited=true', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS al_demo (id INT)')
    await mgr.query('DELETE FROM al_demo')
    const values = Array.from({ length: 600 }, (_v, i) => `(${i})`).join(',')
    await mgr.query(`INSERT INTO al_demo (id) VALUES ${values}`)

    const res = await mgr.queryScript('SELECT * FROM al_demo')
    expect(res.rowCount).toBe(500)
    expect(res.autoLimited).toBe(true)
  })

  it('SQLタブ: skipAutoLimit=true なら全件返る（autoLimited なし）', async () => {
    const res = await mgr.queryScript('SELECT * FROM al_demo', undefined, { skipAutoLimit: true })
    expect(res.rowCount).toBe(600)
    expect(res.autoLimited).toBeUndefined()
  })

  it('SQLタブ: 明示の巨大LIMITは MAX_RESULT_ROWS=10000 で打ち切る', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS hc_demo (id INT)')
    await mgr.query('DELETE FROM hc_demo')
    // 10001 行を挿入（1000 件ずつ）
    for (let base = 0; base < 10001; base += 1000) {
      const cnt = Math.min(1000, 10001 - base)
      const vals = Array.from({ length: cnt }, (_v, i) => `(${base + i})`).join(',')
      await mgr.query(`INSERT INTO hc_demo (id) VALUES ${vals}`)
    }
    const res = await mgr.queryScript('SELECT id FROM hc_demo LIMIT 100000')
    expect(res.rowCount).toBe(10000)
    expect(res.truncated).toBe(true)
  })

  it('isolation: query()/CSV経路は 10000 行ハード上限で打ち切られない', async () => {
    await mgr.query('CREATE TABLE IF NOT EXISTS iso_demo (id INT)')
    await mgr.query('DELETE FROM iso_demo')
    // 10001 行を挿入（1000 件ずつ）
    for (let base = 0; base < 10001; base += 1000) {
      const cnt = Math.min(1000, 10001 - base)
      const vals = Array.from({ length: cnt }, (_v, i) => `(${base + i})`).join(',')
      await mgr.query(`INSERT INTO iso_demo (id) VALUES ${vals}`)
    }
    // query() は runOne を使う（SQL タブの runScript とは別経路）
    const res = await mgr.query('SELECT id FROM iso_demo')
    expect(res.rowCount).toBe(10001)
    expect((res as { truncated?: unknown }).truncated).toBeUndefined()
  })
})
