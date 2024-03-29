#!/usr/bin/env -S node --no-warnings
const dotenv = require('dotenv')
const { Command, Option } = require('commander')
const { Migration, createMigrationFile } = require('./index.js')
const pkg = require('./package.json')

dotenv.config()
const program = new Command()

program
  .name('lpgm')
  .description('Lean PostgreSQL Migrations')
  .version(pkg.version, '-v, --version', 'output the current version')
  .helpOption(' --help', 'get more information')

program
  .addOption(new Option('-d, --dir <directory>', 'The directory containing your migration files').default('./migrations').env('LPGM_DIR'))
  .addOption(new Option('-t, --table <dbtable>', 'The name of the migrations table').default('migrations').env('LPGM_TABLE'))
  .addOption(new Option('-s, --schema <dbschema>', 'The name of the migrations table scheme').default('public').env('LPGM_SCHEMA'))
  .addOption(new Option('-h, --host <host>', 'DB host').default('localhost').env('PGHOST'))
  .addOption(new Option('-p, --port <port>', 'DB port').default('5432').env('PGPORT'))
  .addOption(new Option('-u, --user <user>', 'DB user').default('postgres').env('PGUSER'))
  .addOption(new Option('-D, --db <dbname>', 'DB name').default('postgres').env('PGDATABASE'))
  .addOption(new Option('-P, --password <pswd>', 'DB password').default('postgres').env('PGPASSWORD'))
  .addOption(new Option('--silent', 'Output only fatal errors'))
  .addOption(new Option('--dry', 'Dry run'))

program.addHelpText('after', `
Examples:
  lpgm new create-some-table      # create new migration file
  lpgm new create another table   # same
  lpgm migrate 1                  # execute 1 migration
  lpgm up 1                       # "up" command is an alias of "migrate"
  lpgm migrate                    # execute all migration
  lpgm rollback all               # rollback ALL migrations, dangerous - it turns the DB to it's initial/empty state
  lpgm rollback group             # rollback last executed group of migrations
  lpgm rollback 1                 # rollback 1 migration
  lpgm down 1                     # "down" command is an alias of "rollback"
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
    let migration
    try {
      migration = await initMigration(opts)
      if (arg === 'all' || arg === undefined) {
        await migration.up(0, opts.dry)
      } else {
        const count = parseFloat(arg)
        if (isNaN(count)) {
          console.log(`Invalid argument provided "${arg}"`)
        } else {
          await migration.up(count, opts.dry)
        }
      }
    } catch (e) {
      console.error('Command failed: ', e.toString())
    } finally {
      await migration && migration.end()
    }
  })

program.command('rollback')
  .alias('down')
  .description('Rollback provided number of migrations, all of them or last group(default) ')
  .argument('[Num] | [all] | [group]', 'number of migrations to rollback, "all" or "group"(default)')
  .action(async arg => {
    const opts = program.opts()
    let migration
    try {
      migration = await initMigration(opts)

      if (arg === 'group' || arg === undefined) {
        await migration.rollbackGroup(opts.dry)
      } else if (arg === 'all') {
        await migration.rollbackAll(opts.dry)
      } else {
        const count = parseFloat(arg)
        if (isNaN(count)) {
          console.log(`Invalid argument provided "${arg}"`)
        } else {
          await migration.down(count, opts.dry)
        }
      }
    } catch (e) {
      console.error('Command failed.')
    } finally {
      await migration.end()
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

// ... and here we go ...
program.parse()
