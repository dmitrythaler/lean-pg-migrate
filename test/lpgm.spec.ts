import assert from 'assert'
import fs from 'fs'
import { Migration, createMigrationFile } from '../src/lpgm'
import type { MigrationConfig } from '../src/lpgm'

import pgPromise from 'pg-promise'

// to start PosgreSQL server inside docker container pls run
// > docker run -p 45432:5432 --name tmp-pg --rm -e POSTGRES_PASSWORD=testerwashere -d postgres:latest
// to stop and destroy
// > docker stop tmp-pg
// ... check test:pg:start/stop commands in package.json

const env = process.env

const cfg: MigrationConfig = {
  database: env.PGDATABASE || 'postgres',
  user: env.PGUSER || 'postgres',
  password: env.PGPASSWORD || 'testerwashere',
  port: parseFloat(env.PGPORT || '45432'),
  migrationsDir: 'test/migrations',
  migrationsTable: 'migrations4test',
  silent: true,
  monitor: false
}

describe('Migration usage suite', () => {

  let migration: Migration
  let lockId: number

  const _describe = async () => {
    return await migration.getDB().any(
      `SELECT column_name as col, data_type as type FROM information_schema.columns WHERE table_name = '${cfg.migrationsTable}_1'`
    )
  }

  beforeAll(async () => {
    const pgp = pgPromise({})
    const auxDb = pgp({
      user: cfg.user,
      host: cfg.host,
      database: cfg.database,
      password: cfg.password,
      port: cfg.port,
      max: 20,
      idleTimeoutMillis: 30000
    })
    await auxDb.none(`DROP TABLE IF EXISTS ${cfg.migrationsTable}`)
    await auxDb.none(`DROP TABLE IF EXISTS ${cfg.migrationsTable}_1`)
    await auxDb.$pool.end()

    migration = await Migration.initialize(cfg)
    lockId = migration.getLockId()
  })

  afterAll(async () => {
    await migration.end()
  })

  describe('Migrations', () => {

    it('should start from 0 applied migrations', async () => {
      const res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 0)
    })

    it('should migrate all up', async () => {
      let res = await migration.up()
      assert.strictEqual(res, 4)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 4)
      // const desc = await _describe()
      // console.log('table: ', desc)
    })

    it('shouldn\'t migrate up again', async () => {
      let res = await migration.up()
      assert.strictEqual(res, 0)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 4)
    })

    it('shouldn\'t allow implicitly rollback all migrations by providing incorrect parameter', async () => {
      await assert.rejects(async () => {
        await migration.down(0)
      })
      await assert.rejects(async () => {
        await migration.down(-1)
      })
      const res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 4)
    })

    it('should rollback all migrations', async () => {
      let res = await migration.rollbackAll()
      assert.strictEqual(res, 4)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 0)
    })

    it('shouldn\'t rollback all again', async () => {
      let res = await migration.rollbackAll()
      assert.strictEqual(res, 0)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 0)
    })

    it('should execute the specified number of migrations', async () => {
      let res = await migration.up(3)
      assert.strictEqual(res, 3)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 3)
    })

    it('should rollback the specified number of migrations', async () => {
      let res = await migration.down(2)
      assert.strictEqual(res, 2)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 1)
    })

    it('should migrate only possible number', async () => {
      let res = await migration.up(1000)
      assert.strictEqual(res, 3)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 4)
    })

    it('should rollback only possible number', async () => {
      let res = await migration.down(1000)
      assert.strictEqual(res, 4)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 0)
    })

    it('should rollback by groups', async () => {
      let res = await migration.up(2)
      assert.strictEqual(res, 2)
      res = await migration.up(2)
      assert.strictEqual(res, 2)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 4)

      res = await migration.rollbackGroup()
      assert.strictEqual(res, 2)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)
      res = await migration.rollbackGroup()
      assert.strictEqual(res, 2)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 0)
    })

    it('should do nothing in dry-run mode', async () => {
      let res = await migration.up(2)
      assert.strictEqual(res, 2)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)

      res = await migration.up(2, true/*dry*/)
      assert.strictEqual(res, 0)
      res = await migration.up(0, true/*dry*/)
      assert.strictEqual(res, 0)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)

      res = await migration.rollbackGroup(true/*dry*/)
      assert.strictEqual(res, 0)
      res = await migration.rollbackAll(true/*dry*/)
      assert.strictEqual(res, 0)
      res = await migration.down(2, true/*dry*/)
      assert.strictEqual(res, 0)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)

      await migration.rollbackAll()
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 0)
    })

    it('should correctly exec up migrations', async () => {
      let res = await migration.up(1)
      assert.strictEqual(res, 1)
      let desc = await _describe()
      assert.strictEqual(desc.length, 2)
      assert.strictEqual(desc[0].col, 'id')
      assert.strictEqual(desc[1].col, 'name')
      assert.strictEqual(desc[0].type, 'integer')
      assert.strictEqual(desc[1].type, 'text')

      res = await migration.up(1)
      assert.strictEqual(res, 1)
      desc = await _describe()
      assert.strictEqual(desc.length, 3)
      assert.strictEqual(desc[1].col, 'dummy')
      assert.strictEqual(desc[1].type, 'integer')

      res = await migration.up(1)
      assert.strictEqual(res, 1)
      desc = await _describe()
      assert.strictEqual(desc.length, 4)
      assert.strictEqual(desc[3].col, 'pen_name')
      assert.strictEqual(desc[3].type, 'text')
    })

    it('should correctly exec down migrations', async () => {
      let res = await migration.down(1)
      assert.strictEqual(res, 1)
      let desc = await _describe()
      assert.strictEqual(desc.length, 3)
      assert.strictEqual(desc[0].col, 'id')
      assert.strictEqual(desc[1].col, 'dummy')
      assert.strictEqual(desc[2].col, 'name')
      assert.strictEqual(desc[0].type, 'integer')
      assert.strictEqual(desc[1].type, 'integer')
      assert.strictEqual(desc[2].type, 'text')

      res = await migration.down(1)
      assert.strictEqual(res, 1)
      desc = await _describe()
      assert.strictEqual(desc.length, 2)
      assert.strictEqual(desc[0].col, 'id')
      assert.strictEqual(desc[1].col, 'name')
      assert.strictEqual(desc[0].type, 'integer')
      assert.strictEqual(desc[1].type, 'text')

      res = await migration.down(1)
      assert.strictEqual(res, 1)
      desc = await _describe()
      assert.strictEqual(desc.length, 0)
    })

    it('should create migration file', () => {
      const fn = createMigrationFile('something to think about', cfg.migrationsDir)
      assert.ok(fn)
      assert.ok(fn.length)
      const file = fs.readFileSync(fn)
      assert.ok(file)
      assert.ok(file.length)
      fs.unlinkSync(fn)
    })
  })

  describe('Un/Lock', () => {
    let auxDb

    beforeAll(async () => {
      await migration.up(2)
      let res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)

      const pgp = pgPromise({})
      auxDb = pgp({
        user: cfg.user,
        host: cfg.host,
        database: cfg.database,
        password: cfg.password,
        port: cfg.port,
        max: 20,
        idleTimeoutMillis: 30000
      })
      const { lock } = await auxDb.one(
        'SELECT pg_try_advisory_lock($1) as lock', [lockId]
      )
      assert.strictEqual(lock, true)
    })

    afterAll(async () => {
      auxDb && await auxDb.$pool.end()
      await migration.rollbackAll()
    })

    it('shouldn\'t migrate if lock is not aquired', async () => {
      let res = await migration.up(2)
      assert.strictEqual(res, 0)
      res = await migration.up()
      assert.strictEqual(res, 0)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)
    })

    it('shouldn\'t rollback if lock is not aquired', async () => {
      let res = await migration.rollbackGroup()
      assert.strictEqual(res, 0)
      res = await migration.rollbackAll()
      assert.strictEqual(res, 0)
      res = await migration.down(1000)
      assert.strictEqual(res, 0)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 2)
    })

    it('shouldn migrate/rollback after lock is released', async () => {
      await auxDb.$pool.end()
      auxDb = null

      let res = await migration.up(1)
      assert.strictEqual(res, 1)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 3)
      res = await migration.down(2)
      assert.strictEqual(res, 2)
      res = await migration.appliedMigrationsNum()
      assert.strictEqual(res, 1)
    })

  })
})
