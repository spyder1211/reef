import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ConnectionManager } from './ConnectionManager'

// 既存の ConnectionManager.integration.test.ts と同じ env ベースの接続設定 + skipIf を使う。
// TEST_MYSQL_HOST が無ければスキップ（docker compose -f docker-compose.test.yml up -d で起動）。
const hasDb = !!process.env.TEST_MYSQL_HOST
const cfg = {
  host: process.env.TEST_MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_MYSQL_PORT ?? 13306),
  user: process.env.TEST_MYSQL_USER ?? 'root',
  password: process.env.TEST_MYSQL_PASSWORD ?? 'rootpw',
  database: process.env.TEST_MYSQL_DATABASE ?? 'testdb'
}

describe.skipIf(!hasDb)('ConnectionManager.tableSchema (integration)', () => {
  const manager = new ConnectionManager()

  beforeAll(async () => {
    await manager.connect(cfg)
    await manager.query('DROP TABLE IF EXISTS schema_test')
    await manager.query(`
      CREATE TABLE schema_test (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL COMMENT 'メールアドレス',
        age INT NULL DEFAULT 20,
        PRIMARY KEY (id),
        UNIQUE KEY uq_email (email),
        KEY idx_age_email (age, email)
      )
    `)
  })

  afterAll(async () => {
    await manager.query('DROP TABLE IF EXISTS schema_test')
    await manager.disconnect()
  })

  it('カラム情報を返す', async () => {
    const schema = await manager.tableSchema('schema_test')
    const id = schema.columns.find((c) => c.name === 'id')
    expect(id).toMatchObject({
      nullable: false,
      key: 'PRI',
      extra: expect.stringContaining('auto_increment')
    })
    const email = schema.columns.find((c) => c.name === 'email')
    expect(email).toMatchObject({ type: 'varchar(255)', comment: 'メールアドレス' })
    const age = schema.columns.find((c) => c.name === 'age')
    expect(age).toMatchObject({ nullable: true, default: '20' })
  })

  it('インデックスを Seq_in_index 順のカラム配列で返す', async () => {
    const schema = await manager.tableSchema('schema_test')
    const composite = schema.indexes.find((i) => i.name === 'idx_age_email')
    expect(composite).toMatchObject({ unique: false, columns: ['age', 'email'] })
    const uq = schema.indexes.find((i) => i.name === 'uq_email')
    expect(uq?.unique).toBe(true)
  })

  it('DDL に CREATE TABLE 文を返す', async () => {
    const schema = await manager.tableSchema('schema_test')
    expect(schema.ddl).toContain('CREATE TABLE')
    expect(schema.ddl).toContain('schema_test')
  })

  it('schemaMap が接続中 DB のテーブル→カラム一覧を返す', async () => {
    const map = await manager.schemaMap()
    expect(map.schema_test).toEqual(['id', 'email', 'age'])
  })
})
