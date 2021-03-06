import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

import pgPromise from 'pg-promise'
import type * as T from 'pg-promise'
import monitor from 'pg-monitor'

//  ----------------------------------------------------------------------------------------------//

export type DB = T.IDatabase<{}>

export type DBConnection = {
  database?: string
  host?: string
  port?: number
  user?: string
  password?: string
  ssl?: boolean
}

export type MigrationConfig = DBConnection & {
  migrationsSchema?: string
  migrationsTable?: string
  migrationsDir?: string
  monitor?: boolean
  silent?: boolean
}

export type MigrationRecord = {
  id?: number
  name?: string
  applied_at?: Date
  group_id?: number
}

export type MigrationItself = {
  up?: (t: T.ITask<{}>) => Promise<void>
  down?: (t: T.ITask<{}>) => Promise<void>
} & Record<string, unknown>

//  ---------------------------------
export class Migration {
  private lockId: number
  private config: MigrationConfig
  private db: DB
  private log: (...args: any[]) => void
  private error: (...args: any[]) => void

  private constructor(cfg: MigrationConfig, db: DB) {
    this.config = cfg
    this.db = db
    const dummy = () => {}
    this.log = cfg.silent ? dummy : console.log.bind(console)
    this.error = cfg.silent ? dummy : console.error.bind(console)

    const hash = crypto.createHash('SHAKE128', { outputLength: 7 })
      .update(cfg.host + cfg.port + cfg.database + cfg.migrationsSchema + cfg.migrationsTable)
      .digest('hex')
    this.lockId = parseInt(hash, 16)
  }

  static async initialize(cfg?: MigrationConfig): Promise<Migration> {
    const {
      USER,
      PGUSER,
      PGHOST,
      PGPASSWORD,
      PGDATABASE,
      PGPORT,
      LPGM_SCHEMA,
      LPGM_TABLE,
      LPGM_DIR
    } = process.env

    const config = {
      database: PGDATABASE || USER,
      host: PGHOST || 'localhost',
      port: parseFloat(PGPORT) || 5432,
      user: PGUSER || USER,
      password: PGPASSWORD || null,
      migrationsSchema: LPGM_SCHEMA || 'public',
      migrationsTable: LPGM_TABLE || 'migrations',
      migrationsDir: LPGM_DIR || './migrations',
      monitor: false,
      silent: false,
      ...cfg
    }
    const pgpOpts = { capSQL: true }
    const pgp = pgPromise(pgpOpts)
    if (config.monitor) {
      monitor.attach(pgpOpts)
      monitor.setTheme('matrix')
    }

    const db = pgp({
      user: config.user,
      host: config.host,
      database: config.database,
      password: config.password,
      port: config.port,
      max: 20,
      idleTimeoutMillis: 30000
    })

    try {
      await db.task(async t => {
        // after connect check if migration table is here
        const tables = await t.any(
          'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
          [config.migrationsSchema, config.migrationsTable]
        )
        if (!tables.length) {
          // table does not exist yet
          await t.none(
            'CREATE TABLE $1~.$2~ (id SERIAL PRIMARY KEY, name TEXT, applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), group_id INTEGER)',
            [config.migrationsSchema, config.migrationsTable]
          )
        }
      })
    } catch (er) {
      if (!config.silent) {
        console.error('Migration init error:', er.toString())
      }
      throw er
    }
    return new Migration(config, db)
  }

  /**
   * config getter
   * @returns {MigrationConfig}
   */
  getConfig(): MigrationConfig {
    return this.config
  }

  /**
   * db getter
   * @returns {DB}
   */
  getDB(): DB {
    return this.db
  }

  private async getLock(): Promise<boolean> {
    const { aquired } = await this.db.one(
      'SELECT pg_try_advisory_lock($1) as aquired', [this.lockId]
    )
    return aquired
  }

  private async releaseLock(): Promise<boolean> {
    const { released } = await this.db.one(
      'SELECT pg_advisory_unlock($1) as released', [this.lockId]
    )
    return released
  }

  /**
   * lockId getter, only for tests
   * @returns {number}
   */
  getLockId(): number {
    return this.lockId
  }

  /**
   * number of already applied migrations
   *
   * @returns {Promise<number>}
   */
  async appliedMigrationsNum(): Promise<number> {
    const { count } = await this.db.one(
        'SELECT COUNT(*) as count FROM $1~.$2~',
        [this.config.migrationsSchema, this.config.migrationsTable]
      )
    return parseFloat(count)
  }

  private async loadMigration(migFile: string): Promise<MigrationItself> {
    const migPathFile = path.resolve(path.join(this.config.migrationsDir, migFile))
    return await import(migPathFile)
  }

  /**
   * @private
   * apply 1 migrations
   */
  private async oneUp(migFile: string, groupId: number): Promise<void> {
    await this.db.tx(async t => {
      try {
        const { up } = await this.loadMigration(migFile)
        up && await up(t)
        this.log(`+ Migration "${migFile}" applied.`)

        await t.none(
          `INSERT INTO $1~.$2~ (name, group_id) VALUES ($3, $4)`, [
            this.config.migrationsSchema,
            this.config.migrationsTable,
            migFile,
            groupId
          ]
        )
      } catch (er) {
        er.migration = migFile
        throw er
      }
    })
  }

  /**
   * apply provided number of migrations
   *
   * @param {number} count - optional number of migrations to apply, absent or 0 means all migrations
   * @param {boolean} dry - dry run mode, optional, false by default
   * @returns {Promise<number>} - number of applied migrations
   */
  async up(count?: number, dry = false): Promise<number> {
    const lockAquired = await this.getLock()
    if (!lockAquired) {
      this.log(`Migration already locked! It seems to be executed by another service.`)
      return 0
    }

    let files: string[]

    try {
      files = fs.readdirSync(this.config.migrationsDir, { withFileTypes: true })
        .filter(dr => dr.isFile() && dr.name.slice(-3) === '.js')
        .map(dr => dr.name)
        .sort()
    } catch (er) {
      this.error(`Error reading "${path.resolve(this.config.migrationsDir)}" directory!`)
      throw er
    }

    if (!files.length) {
      this.log(`No migrations found in "${path.resolve(this.config.migrationsDir)}" directory!`)
      return 0
    }

    try {
      // get the last applied migration
      const last = await this.db.oneOrNone(
        'SELECT name FROM $1~.$2~ ORDER BY id DESC LIMIT 1', [
          this.config.migrationsSchema,
          this.config.migrationsTable
        ]
      )

      if (last) {
        // remove already applied migrations from the file list
        while (files.length && files[0] !== last.name) {
          files.shift()
        }
        files.shift()
      }
      if (!files.length) {
        this.log(`No migrations left to apply.`)
        return 0
      }

      // apply provided limit
      if (count > 0 && files.length > count) {
        files.length = count
      }
      // assign one groupId to all migrations
      const groupId = Math.round(Math.random() * 2_000_000_000)
      // exec migrations one by one
      for (const f of files) {
        if (dry) {
          this.log(`+ Migration "${f}" applied. (dry run)`)
        } else {
          await this.oneUp(f, groupId)
        }
      }

      return dry ? 0 : files.length
    } catch (er) {
      const migFile = er.migration ? `(file: ${er.migration}) ` : ''
      this.error(`Migrations exec error: ${migFile}${er.toString()}`)
      throw er
    } finally {
      await this.releaseLock()
    }
  }

  /**
   * @private
   * rollback 1 migrations
   */
  private async oneDown(migFile: string, id: number): Promise<void> {
    await this.db.tx(async t => {
      try {
        const { down } = await this.loadMigration(migFile)
        down && await down(t)
        this.log(`- Migration "${migFile}" rolled back.`)

        await t.none(
          `DELETE FROM $1~.$2~ WHERE id = $3`, [
          this.config.migrationsSchema,
          this.config.migrationsTable,
          id
        ]
        )
      } catch (er) {
        er.migration = migFile
        throw er
      }
    })
  }

  /**
   * @private
   * rollback provided list of migrations
   */
  private async execDown(rows: MigrationRecord[], dry: boolean): Promise<number> {
    if (!rows || !rows.length) {
      this.log(`No migrations left to rollback.`)
      return 0
    }
    // rollback them one by one
    for (const row of rows) {
      if (dry) {
        this.log(`- Migration "${row.name}" rolled back. (dry run)`)
      } else {
        await this.oneDown(row.name, row.id)
      }
    }
    return dry ? 0 : rows.length
  }

  /**
   * rollbacks given number of migrations
   *
   * @param {number} count - number of migrations to rollback, absence or less than 1 will throw
   * @param {boolean} dry - dry run mode, optional, false by default
   * @returns {Promise<number>} - number of migrations rolled back
   */
  async down(count: number, dry = false): Promise<number> {
    if (!(count > 0)) {
      // count not provided or negative or zero
      throw new Error(`Wrong migration number provided: ${count}`)
    }

    const lockAquired = await this.getLock()
    if (!lockAquired) {
      this.log(`Migration already locked! It seems to be executed by another service.`)
      return 0
    }

    try {
      // get last applied migrations
      const rows = await this.db.any(
        'SELECT id, name FROM $1~.$2~ ORDER BY id DESC LIMIT $3', [
          this.config.migrationsSchema,
          this.config.migrationsTable,
          count
        ]
      )

      return await this.execDown(rows, dry)
    } catch (er) {
      const migFile = er.migration ? `(file: ${er.migration}) ` : ''
      this.error(`Migrations rollback error: ${migFile}${er.toString()}`)
      throw er
    } finally {
      await this.releaseLock()
    }
  }

  /**
   * rollbacks all migrations
   *
   * @param {boolean} dry - dry run mode, optional, false by default
   * @returns {Promise<number>} - number of migrations rolled back
   */
  async rollbackAll(dry = false): Promise<number> {
    const lockAquired = await this.getLock()
    if (!lockAquired) {
      this.log(`Migration already locked! It seems to be executed by another service.`)
      return 0
    }

    try {
      // get last applied migrations
      const rows = await this.db.any(
        'SELECT id, name FROM $1~.$2~ ORDER BY id DESC', [
          this.config.migrationsSchema,
          this.config.migrationsTable
        ]
      )

      return await this.execDown(rows, dry)
    } catch (er) {
      const migFile = er.migration ? `(file: ${er.migration}) ` : ''
      this.error(`Migrations rollback error: ${migFile}${er.toString()}`)
      throw er
    } finally {
      await this.releaseLock()
    }
  }

  /**
   * rollbacks last group of migrations
   *
   * @param {boolean} dry - dry run mode, optional, false by default
   * @returns {Promise<number>} - number of migrations rolled back
   */
  async rollbackGroup(dry = false): Promise<number> {
    const lockAquired = await this.getLock()
    if (!lockAquired) {
      this.log(`Migration already locked! It seems to be executed by another service.`)
      return 0
    }

    try {
      const rows = await this.db.task(async t => {
        // get last applied migration
        const row = await t.oneOrNone(
          'SELECT group_id FROM $1~.$2~ ORDER BY id DESC LIMIT 1', [
            this.config.migrationsSchema,
            this.config.migrationsTable
          ]
        )

        if (!row) {
          return []
        }

        // get migrations with the same group as the last one
        return await t.many(
          'SELECT id, name FROM $1~.$2~ WHERE group_id = $3 ORDER BY id DESC', [
            this.config.migrationsSchema,
            this.config.migrationsTable,
            row.group_id
          ]
        )
      })

      return await this.execDown(rows, dry)
    } catch (er) {
      const migFile = er.migration ? `(file: ${er.migration}) ` : ''
      this.error(`Migrations rollback error: ${migFile}${er.toString()}`)
      throw er
    } finally {
      await this.releaseLock()
    }
  }

  /**
   * close DB connection and release pool
   */
  async end(): Promise<void> {
    await this.db.$pool.end()
  }
}

//  ----------------------------------------------------------------------------------------------//

const fileContent = `
// trx - pg-promise's transaction/task (ITask<{}>)
// please refer to https://vitaly-t.github.io/pg-promise/Task.html

export const up = async function(trx) {
  return await trx.none(
    'CREATE TABLE one (id SERIAL PRIMARY KEY, name TEXT, creted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())'
  )
}

export const down = async function(trx) {
  return await trx.none(
    'DROP TABLE one'
  )
}
`

/**
 * create migration file in format YYYYMMDD-HHMMSS-provided-file-name.js
 *
 * @param {string} - file name
 * @param {string} - directory name
 * @returns {Promise<string>} - name of the new file
 */
export const createMigrationFile = (name: string, dir = './migrations'): string => {
  // 2022-02-15T21:48:36.672Z to 20220215-214836
  const prefix = (new Date()).toISOString().split('.')[0].replace(/\-/g, '').replace(/\:/g, '').replace(/T/g, '-')
  // 20220215-214836-name-lowercased-and-spaces-replaced-with-dashes
  const fileName = `${prefix}-${name.toLowerCase().replace(/\s/g, '-')}.js`
  try {
    const pathFile = path.join(dir, fileName)
    fs.writeFileSync(pathFile, fileContent)
    return pathFile
  } catch (error) {
    console.error(`Migration file "${fileName}" creation error: ${error.toString()}`)
    return ''
  }

}
