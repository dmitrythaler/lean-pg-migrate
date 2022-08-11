import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import postgres from 'postgres';
//  ---------------------------------
export class Migration {
    /**
     * @private @constructor
     */
    constructor(cfg, sql) {
        this.config = cfg;
        this.sql = sql;
        this.table = sql(`${cfg.migrationsSchema}.${cfg.migrationsTable}`);
        if (cfg.silent) {
            this.log = () => { };
            this.error = () => { };
        }
        else {
            this.log = console.log.bind(console);
            this.error = console.error.bind(console);
        }
        // gen lock id based on hashed connection parameters
        const hash = crypto.createHash('SHAKE128', { outputLength: 7 })
            .update(cfg.host + cfg.port + cfg.database + cfg.migrationsSchema + cfg.migrationsTable)
            .digest('hex');
        this.lockId = parseInt(hash, 16);
    }
    /**
     * Inits new Migration
     *
     * @param {MigrationConfig} cfg
     * @returns initialized Migration rig
     */
    static async initialize(cfg) {
        const { USER, PGUSER, PGHOST, PGPASSWORD, PGDATABASE, PGPORT, LPGM_SCHEMA, LPGM_TABLE, LPGM_DIR } = process.env;
        const config = {
            database: PGDATABASE || USER,
            host: PGHOST || 'localhost',
            port: parseFloat(PGPORT) || 5432,
            user: PGUSER || USER,
            password: PGPASSWORD || null,
            max: 20,
            idle_timeout: 30,
            migrationsSchema: LPGM_SCHEMA || 'public',
            migrationsTable: LPGM_TABLE || 'migrations',
            migrationsDir: LPGM_DIR || './migrations',
            silent: false,
            ...cfg
        };
        const sql = postgres({
            user: config.user,
            host: config.host,
            database: config.database,
            password: config.password,
            port: config.port,
            max: config.max,
            idle_timeout: config.idle_timeout
        });
        try {
            const table = sql(`${config.migrationsSchema}.${config.migrationsTable}`);
            await sql `
        CREATE TABLE IF NOT EXISTS ${table} (
          id SERIAL PRIMARY KEY,
          name TEXT,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          group_id INTEGER
        )
        `;
        }
        catch (er) {
            console.error('Migration init error:', er.toString());
            throw er;
        }
        return new Migration(config, sql);
    }
    /**
     * some getters below, mainly for testing
     */
    getConfig() {
        return this.config;
    }
    getSql() {
        return this.sql;
    }
    getLockId() {
        return this.lockId;
    }
    /**
     * Aquires advisory lock based on hash
     * @returns {Sql}
     */
    async aquireLock() {
        const [row] = await this.sql `
      SELECT pg_try_advisory_lock(${this.lockId}) as aquired
      `;
        return row.aquired;
    }
    async releaseLock() {
        const [row] = await this.sql `
      SELECT pg_advisory_unlock(${this.lockId}) as released
      `;
        return row.released;
    }
    /**
     * number of already applied migrations
     *
     * @returns {Promise<number>}
     */
    async appliedMigrationsNum() {
        const [row] = await this.sql `
      SELECT COUNT(*) as count FROM ${this.table}
      `;
        return parseFloat(row.count);
    }
    async loadMigration(migFile) {
        const migPathFile = path.resolve(path.join(this.config.migrationsDir, migFile));
        return await import(migPathFile);
    }
    /**
     * @private
     * apply 1 migrations
     */
    async oneUp(migFile, groupId) {
        await this.sql.begin(async (t) => {
            try {
                const { up } = await this.loadMigration(migFile);
                up && await up(t);
                await t `
          INSERT INTO ${this.table} (name, group_id)
            VALUES (${migFile}, ${groupId})
          `;
                this.log(`+ Migration "${migFile}" applied.`);
            }
            catch (er) {
                er.migration = migFile;
                throw er;
            }
        });
    }
    /**
     * apply provided number of migrations
     *
     * @param {number} count - optional number of migrations to apply, absent or 0 means all migrations
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of applied migrations
     */
    async up(count, dry = false) {
        const lockAquired = await this.aquireLock();
        if (!lockAquired) {
            this.log(`Migration already locked! It seems to be executed by another service.`);
            return 0;
        }
        let files;
        try {
            files = fs.readdirSync(this.config.migrationsDir, { withFileTypes: true })
                .filter(dr => dr.isFile() && dr.name.slice(-3) === '.js')
                .map(dr => dr.name)
                .sort();
        }
        catch (er) {
            this.error(`Error reading "${path.resolve(this.config.migrationsDir)}" directory!`);
            throw er;
        }
        if (!files.length) {
            this.log(`No migrations found in "${path.resolve(this.config.migrationsDir)}" directory!`);
            return 0;
        }
        try {
            // get the last applied migration
            const [last] = await this.sql `
        SELECT name FROM ${this.table}
          ORDER BY id DESC LIMIT 1
        `;
            if (last) {
                // remove already applied migrations from the file list
                while (files.length && files[0] !== last.name) {
                    files.shift();
                }
                files.shift();
            }
            if (!files.length) {
                this.log(`No migrations left to apply.`);
                return 0;
            }
            // apply provided limit
            if (count > 0 && files.length > count) {
                files.length = count;
            }
            // assign one groupId to all migrations
            const groupId = Math.round(Math.random() * 2000000000);
            // exec migrations one by one
            for (const f of files) {
                if (dry) {
                    this.log(`+ Migration "${f}" applied. (dry run)`);
                }
                else {
                    await this.oneUp(f, groupId);
                }
            }
            return dry ? 0 : files.length;
        }
        catch (er) {
            const migFile = er.migration ? `(file: ${er.migration}) ` : '';
            this.error(`Migrations exec error: ${migFile}${er.toString()}`);
            throw er;
        }
        finally {
            await this.releaseLock();
        }
    }
    /**
     * @private
     * rollback 1 migrations
     */
    async oneDown(migFile, id) {
        await this.sql.begin(async (t) => {
            try {
                const { down } = await this.loadMigration(migFile);
                down && await down(t);
                this.log(`- Migration "${migFile}" rolled back.`);
                await t `DELETE FROM ${this.table} WHERE id = ${id}`;
            }
            catch (er) {
                er.migration = migFile;
                throw er;
            }
        });
    }
    /**
     * @private
     * rollback provided list of migrations
     */
    async execDown(rows, dry) {
        if (!rows || !rows.length) {
            this.log(`No migrations left to rollback.`);
            return 0;
        }
        // rollback them one by one
        for (const row of rows) {
            if (dry) {
                this.log(`- Migration "${row.name}" rolled back. (dry run)`);
            }
            else {
                await this.oneDown(row.name, row.id);
            }
        }
        return dry ? 0 : rows.length;
    }
    /**
     * rollbacks given number of migrations
     *
     * @param {number} count - number of migrations to rollback, absence or less than 1 will throw
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of migrations rolled back
     */
    async down(count, dry = false) {
        if (!(count > 0)) {
            // count not provided or negative or zero
            throw new Error(`Wrong migration number provided: ${count}`);
        }
        const lockAquired = await this.aquireLock();
        if (!lockAquired) {
            this.log(`Migration already locked! It seems to be executed by another service.`);
            return 0;
        }
        try {
            // get last applied migrations
            const rows = await this.sql `
        SELECT id, name FROM ${this.table}
          ORDER BY id DESC LIMIT ${count}
        `;
            return await this.execDown(rows, dry);
        }
        catch (er) {
            const migFile = er.migration ? `(file: ${er.migration}) ` : '';
            this.error(`Migrations rollback error: ${migFile}${er.toString()}`);
            throw er;
        }
        finally {
            await this.releaseLock();
        }
    }
    /**
     * rollbacks all migrations
     *
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of migrations rolled back
     */
    async rollbackAll(dry = false) {
        const lockAquired = await this.aquireLock();
        if (!lockAquired) {
            this.log(`Migration already locked! It seems to be executed by another service.`);
            return 0;
        }
        try {
            // get all applied migrations
            const rows = await this.sql `
        SELECT id, name FROM ${this.table}
          ORDER BY id DESC
        `;
            return await this.execDown(rows, dry);
        }
        catch (er) {
            const migFile = er.migration ? `(file: ${er.migration}) ` : '';
            this.error(`Migrations rollback error: ${migFile}${er.toString()}`);
            throw er;
        }
        finally {
            await this.releaseLock();
        }
    }
    /**
     * rollbacks last group of migrations
     *
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of migrations rolled back
     */
    async rollbackGroup(dry = false) {
        const lockAquired = await this.aquireLock();
        if (!lockAquired) {
            this.log(`Migration already locked! It seems to be executed by another service.`);
            return 0;
        }
        try {
            const rows = await this.sql.begin(async (t) => {
                // get last applied migration
                const [last] = await t `SELECT group_id FROM ${this.table} ORDER BY id DESC LIMIT 1`;
                if (!last) {
                    return [];
                }
                // get migrations with the same group as the last one
                return await t `
          SELECT id, name FROM ${this.table}
            WHERE group_id = ${last.group_id}
            ORDER BY id DESC
          `;
            });
            return await this.execDown(rows, dry);
        }
        catch (er) {
            const migFile = er.migration ? `(file: ${er.migration}) ` : '';
            this.error(`Migrations rollback error: ${migFile}${er.toString()}`);
            throw er;
        }
        finally {
            await this.releaseLock();
        }
    }
    /**
     * close DB connection and release pool
     */
    async end() {
        await this.sql.end( /*{ timeout: 5 }*/);
    }
}
//  ----------------------------------------------------------------------------------------------//
const fileContent = `
// sql - transaction from Postgres.js
// please refer to https://github.com/porsager/postgres

export const up = async function(sql) {
  return await sql\`
    CREATE TABLE one (id SERIAL PRIMARY KEY, name TEXT, creted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())
    \`
}

export const down = async function(sql) {
  return await sql\`DROP TABLE one\`
}
`;
/**
 * create migration file in format YYYYMMDD-HHMMSS-provided-file-name.js
 *
 * @param {string} - file name
 * @param {string} - directory name
 * @returns {Promise<string>} - name of the new file
 */
export const createMigrationFile = (name, dir = './migrations') => {
    // 2022-02-15T21:48:36.672Z to 20220215-214836
    const prefix = (new Date()).toISOString().split('.')[0].replace(/\-/g, '').replace(/\:/g, '').replace(/T/g, '-');
    // 20220215-214836-name-lowercased-and-spaces-replaced-with-dashes
    const fileName = `${prefix}-${name.toLowerCase().replace(/\s/g, '-')}.js`;
    try {
        const pathFile = path.join(dir, fileName);
        fs.writeFileSync(pathFile, fileContent);
        return pathFile;
    }
    catch (error) {
        console.error(`Migration file "${fileName}" creation error: ${error.toString()}`);
        return '';
    }
};
