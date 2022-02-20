"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMigrationFile = exports.Migration = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pg_promise_1 = __importDefault(require("pg-promise"));
const pg_monitor_1 = __importDefault(require("pg-monitor"));
//  ---------------------------------
class Migration {
    constructor(cfg, db) {
        this.config = cfg;
        this.db = db;
    }
    static async initialize(cfg) {
        const { USER, PGUSER, PGHOST, PGPASSWORD, PGDATABASE, PGPORT, LPGM_SCHEMA, LPGM_TABLE, LPGM_DIR } = process.env;
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
            silent: true,
            ...cfg
        };
        const pgpOpts = { capSQL: true };
        const pgp = (0, pg_promise_1.default)(pgpOpts);
        if (config.monitor) {
            pg_monitor_1.default.attach(pgpOpts);
            pg_monitor_1.default.setTheme('matrix');
        }
        const db = pgp({
            user: config.user,
            host: config.host,
            database: config.database,
            password: config.password,
            port: config.port,
            max: 20,
            idleTimeoutMillis: 30000
        });
        try {
            await db.task(async (t) => {
                // after connect check if migration table is here
                const tables = await t.any('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2', [config.migrationsSchema, config.migrationsTable]);
                if (!tables.length) {
                    // table does not exist yet
                    await t.none('CREATE TABLE $1~.$2~ (id SERIAL PRIMARY KEY, name TEXT, applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), group_id INTEGER)', [config.migrationsSchema, config.migrationsTable]);
                }
            });
        }
        catch (er) {
            console.error('Migration init error:', er.toString());
        }
        return new Migration(config, db);
    }
    log(...args) {
        if (!this.config.silent) {
            console.log(...args);
        }
    }
    /**
     * number of already applied migrations
     *
     * @returns {Promise<number>}
     */
    async appliedMigrationsNum() {
        const { count } = await this.db.one('SELECT COUNT(*) as count FROM $1~.$2~', [this.config.migrationsSchema, this.config.migrationsTable]);
        return parseFloat(count);
    }
    async loadMigration(migFile) {
        const migPathFile = path_1.default.resolve(path_1.default.join(this.config.migrationsDir, migFile));
        try {
            return await Promise.resolve().then(() => __importStar(require(migPathFile)));
        }
        catch (er) {
            console.error(`Migration file "${migPathFile}" loading error:`, er);
            throw er;
        }
    }
    /**
     * @private
     * apply 1 migrations
     */
    async oneUp(migFile, groupId) {
        await this.db.tx(async (t) => {
            try {
                const { up } = await this.loadMigration(migFile);
                up && await up(t);
                this.log(`+ Migration "${migFile}" applied.`);
                await t.none(`INSERT INTO $1~.$2~ (name, group_id) VALUES ($3, $4)`, [
                    this.config.migrationsSchema,
                    this.config.migrationsTable,
                    migFile,
                    groupId
                ]);
            }
            catch (er) {
                console.error(`Migration ${migFile} exec error:`, er);
                throw er;
            }
        });
    }
    /**
     * apply provided number of migrations
     *
     * @param {int} - optional number of migrations to apply, absent means all migrations
     * @returns {Promise<number>} - number of applied migrations
     */
    async up(count) {
        let files;
        try {
            files = fs_1.default.readdirSync(this.config.migrationsDir, { withFileTypes: true })
                .filter(dr => dr.isFile() && dr.name.slice(-3) === '.js')
                .map(dr => dr.name)
                .sort();
        }
        catch (er) {
            console.error(`Error reading "${path_1.default.resolve(this.config.migrationsDir)}" directory!`);
            return 0;
        }
        if (!files.length) {
            console.warn(`No migrations found in "${path_1.default.resolve(this.config.migrationsDir)}" directory!`);
            return 0;
        }
        try {
            // get the last applied migration
            const last = await this.db.oneOrNone('SELECT name FROM $1~.$2~ ORDER BY id DESC LIMIT 1', [
                this.config.migrationsSchema,
                this.config.migrationsTable
            ]);
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
                await this.oneUp(f, groupId);
            }
            return files.length;
        }
        catch (er) {
            console.error('Migrations exec error:', er);
            return 0;
        }
    }
    /**
     * @private
     * rollback 1 migrations
     */
    async oneDown(migFile, id) {
        await this.db.tx(async (t) => {
            try {
                const { down } = await this.loadMigration(migFile);
                down && await down(t);
                this.log(`- Migration "${migFile}" rolled back.`);
                await t.none(`DELETE FROM $1~.$2~ WHERE id = $3`, [
                    this.config.migrationsSchema,
                    this.config.migrationsTable,
                    id
                ]);
            }
            catch (er) {
                console.error(`Migration "${migFile}" rollback error:`, er);
                throw er;
            }
        });
    }
    /**
     * @private
     * rollback provided list of migrations
     */
    async execDown(rows) {
        if (!rows || !rows.length) {
            this.log(`No migrations left to rollback.`);
            return 0;
        }
        // rollback them one by one
        for (const row of rows) {
            await this.oneDown(row.name, row.id);
        }
        return rows.length;
    }
    /**
     * rollbacks given number of migrations
     *
     * @param {int} count - number of migrations to rollback, absence or less than 1 will throw
     * @returns {Promise<number>} - number of migrations rolled back
     */
    async down(count) {
        if (!(count > 0)) {
            // count not provided or negative or zero
            throw new Error(`Wrong migration number provided: ${count}`);
        }
        try {
            // get last applied migrations
            const rows = await this.db.any('SELECT id, name FROM $1~.$2~ ORDER BY id DESC LIMIT $3', [
                this.config.migrationsSchema,
                this.config.migrationsTable,
                count
            ]);
            return await this.execDown(rows);
        }
        catch (er) {
            console.error('Migrations rollback error:', er);
            return 0;
        }
    }
    /**
     * rollbacks all migrations
     *
     * @returns {Promise<number>} - number of migrations rolled back
     */
    async rollbackAll() {
        try {
            // get last applied migrations
            const rows = await this.db.any('SELECT id, name FROM $1~.$2~ ORDER BY id DESC', [
                this.config.migrationsSchema,
                this.config.migrationsTable
            ]);
            return await this.execDown(rows);
        }
        catch (er) {
            console.error('Migrations rollback error:', er);
            return 0;
        }
    }
    /**
     * rollbacks last group of migrations
     *
     * @returns {Promise<number>} - number of migrations rolled back
     */
    async rollbackGroup() {
        try {
            const rows = await this.db.task(async (t) => {
                // get last applied migration
                const row = await t.oneOrNone('SELECT group_id FROM $1~.$2~ ORDER BY id DESC LIMIT 1', [
                    this.config.migrationsSchema,
                    this.config.migrationsTable
                ]);
                if (!row) {
                    return [];
                }
                // get migrations with the same group as the last one
                return await t.many('SELECT id, name FROM $1~.$2~ WHERE group_id = $3 ORDER BY id DESC', [
                    this.config.migrationsSchema,
                    this.config.migrationsTable,
                    row.group_id
                ]);
            });
            return await this.execDown(rows);
        }
        catch (er) {
            console.error('Migrations rollback error:', er);
            return 0;
        }
    }
    /**
     * close DB connection and release pool
     */
    async end() {
        await this.db.$pool.end();
    }
}
exports.Migration = Migration;
//  ----------------------------------------------------------------------------------------------//
const fileContent = `
// trx - pg-promise's transaction

const up = async function(trx) {
  return await trx.none(
    'CREATE TABLE one (id SERIAL PRIMARY KEY, name TEXT, creted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())'
  )
}

const down = async function(trx) {
  return await trx.none(
    'DROP TABLE one'
  )
}

module.exports = { up, down }
`;
/**
 * create migration file in format YYYYMMDD-HHMMSS-provided-file-name.js
 *
 * @param {string} - file name
 * @param {string} - directory name
 * @returns {Promise<string>} - name of the new file
 */
const createMigrationFile = (name, dir = './migrations') => {
    // 2022-02-15T21:48:36.672Z to 20220215-214836
    const prefix = (new Date()).toISOString().split('.')[0].replace(/\-/g, '').replace(/\:/g, '').replace(/T/g, '-');
    // 20220215-214836-name-lowercased-and-spaces-replaced-with-dashes
    const fileName = `${prefix}-${name.toLowerCase().replace(/\s/g, '-')}.js`;
    try {
        const pathFile = path_1.default.join(dir, fileName);
        fs_1.default.writeFileSync(pathFile, fileContent);
        return pathFile;
    }
    catch (error) {
        console.error(`Migration file "${fileName}" creation error: ${error.toString()}`);
        return '';
    }
};
exports.createMigrationFile = createMigrationFile;
