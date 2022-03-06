# Lean PG Migrate

Simple PostgreSQL migration tool.

Simple Up/Down js migrations based on the pg-promise library.
It is a spin-off from a larger project and was not originally intended to be published.

WIP
## CLI

```console
Usage: lpgm [options] [command]

Lean PostgreSQL Migrations

Options:
  -V, --version                          output the version number
  -d, --dir <directory>                  The directory containing your migration files (default: "./migrations", env: LPGM_DIR)
  -t, --table <dbtable>                  The name of the migrations table (default: "migrations", env: LPGM_TABLE)
  -s, --schema <dbschema>                The name of the migrations table scheme (default: "public", env: LPGM_SCHEMA)
  -C, --connection <db-url>              DB connection string (env: DATABASE_URL)
  -H, --host <host>                      DB host (default: "localhost", env: PGHOST)
  -p, --port <port>                      DB port (default: "5432", env: PGPORT)
  -U, --user <user>                      DB user (default: "postgres", env: PGUSER)
  -W, --password <pswd>                  DB password (default: "postgres", env: PGPASSWORD)
  -D, --db <dbname>                      DB name (default: "postgres", env: PGDATABASE)
      --silent                           No output
      --monitor                          Attach pg-monitor and log actual SQL commands in console
      --dry                              Dry run
  -h, --help                             display help for command

Commands:
  migrate|up [Num] | [all]               Exec provided number of migrations or all of them(default)
  rollback|down [Num] | [all] | [group]  Rollback provided number of migrations, all of them or last group(default)
  new|create <name...>                   Creates new migration files in format YYYYMMDD-HHMMSS-provided-migration-description.js
  help [command]                         display help for command

Examples:
  lpgm new create-some-table      # create new migration file
  lpgm new create-another-table   # same
  lpgm migrate 1                  # execute 1 migration
  lpgm up 1                       # "up" command is an alias of "migrate"
  lpgm migrate                    # execute all migration
  lpgm rollback all               # rollback ALL migrations, dangerous - it turns the DB to it's "virgin" state
  lpgm rollback group             # rollback last executed group of migrations
  lpgm rollback 1                 # rollback 1 migration
  lpgm down 1                     # "down" command is an alias of "rollback"

```

## API
tbd...