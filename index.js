#!/usr/bin/env node
const dotenv = require('dotenv')
const { Command, Option } = require('commander')
const { Migration, createMigrationFile } = require('./lpgm.js')
const { version } = require('./package.json')

dotenv.config()
const program = new Command()

program
  .name('lpgm')
  .description('Lean PostgreSQL Migrations')
  .option('--silent', 'Show only errors/warnings')
  .option('--monitor', 'Attach pg-monitor and log actual SQL commands in console')
  .version(version)

program
  .addOption(new Option('-d, --dir <directory>', 'The directory containing your migration files').default('./migrations').env('LPGM_DIR'))
  .addOption(new Option('-t, --table <dbtable>', 'The name of the migrations table').default('migrations').env('LPGM_TABLE'))
  .addOption(new Option('-s, --schema <dbschema>', 'The name of the migrations table scheme').default('public').env('LPGM_SCHEMA'))
  .addOption(new Option('-C, --connection <db-url>', 'DB connection string').env('DATABASE_URL'))
  .addOption(new Option('-H, --host <host>', 'DB host').default('localhost').env('PGHOST'))
  .addOption(new Option('-p, --port <port>', 'DB port').default('5432').env('PGPORT'))
  .addOption(new Option('-U, --user <user>', 'DB user').default('postgres').env('PGUSER'))
  .addOption(new Option('-W, --password <pswd>', 'DB password').default('postgres').env('PGPASSWORD'))
  .addOption(new Option('-D, --db <dbname>', 'DB name').default('postgres').env('PGDATABASE'))

program.addHelpText('after', `
Examples:
  lpgm new create-some-table
  lpgm new create-another-table
  lpgm migrate 1
  lpgm migrate
  lpgm rollback all
  lpgm rollback group
  lpgm rollback 1
`)

const initMigration = async opts =>
  await Migration.initialize({
    host: opts.host,
    port: opts.port,
    database: opts.db,
    user: opts.user,
    password: opts.password,
    migrationsDir: opts.dir,
    migrationsTable: opts.table,
    silent: opts.silent,
    monitor: opts.monitor
  })

program.command('migrate')
  .alias('up')
  .description('Exec provided number of migrations or all of them(default)')
  .argument('[Num] | [all]', 'number of migrations to apply or "all"(default)')
  .action(async arg => {
    const opts = program.opts()
    try {
      const migration = await initMigration(opts)
      if (arg === 'all' || arg === undefined) {
        await migration.up()
      } else {
        const count = parseFloat(arg)
        if (isNaN(count)) {
          console.log(`Invalid argument provided "${arg}"`)
        } else {
          await migration.up(count)
        }
      }
      await migration.end()
    } catch (e) {
      console.error(`Command failed: ${e.toString()}`)
    }
  })

program.command('rollback')
  .alias('down')
  .description('Rollback provided number of migrations, all of them or last group(default) ')
  .argument('[Num] | [all] | [group]', 'number of migrations to rollback, "all" or "group"(default)')
  .action(async arg => {
    const opts = program.opts()
    try {
      const migration = await initMigration(opts)

      if (arg === 'group' || arg === undefined) {
        await migration.rollbackGroup()
      } else if (arg === 'all') {
        await migration.rollbackAll()
      } else {
        const count = parseFloat(arg)
        if (isNaN(count)) {
          console.log(`Invalid argument provided "${arg}"`)
        } else {
          await migration.down(count)
        }
      }
      await migration.end()
    } catch (e) {
      console.error(`Command failed: ${e.toString()}`)
    }
  })


program.command('new')
  .alias('create')
  .description('Creates new migration files in format YYYYMMDD-HHMMSS-provided-migration-description.js')
  .argument('<name...>', 'file name and/or migration short description')
  .action(arg => {
    const opts = program.opts()
    const fileName = createMigrationFile(arg.join('-'), opts.dir)
    if (fileName) {
      console.log(`Migration file "${fileName}" created.`)
    }
  })

// debug
program.command('log')
  .alias('test')
  .description('just to test ...')
  .argument('[Num] | <all>', 'number of migrations to apply or "all"(default)')
  .action(arg => {
    const opts = program.opts()
    console.log(arg)
    console.log(opts)
  })

// ... and here we go ...
program.parse()

