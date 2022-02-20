import type * as T from 'pg-promise';
export declare type DB = T.IDatabase<{}>;
export declare type DBConnection = {
    database?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    ssl?: boolean;
};
export declare type MigrationConfig = DBConnection & {
    migrationsSchema?: string;
    migrationsTable?: string;
    migrationsDir?: string;
    monitor?: boolean;
    silent?: boolean;
};
export declare type MigrationRecord = {
    id?: number;
    name?: string;
    applied_at?: Date;
    group_id?: number;
};
export declare type MigrationItself = {
    up?: (db: T.ITask<{}>) => Promise<void>;
    down?: (db: T.ITask<{}>) => Promise<void>;
} & Record<string, unknown>;
export declare class Migration {
    config: MigrationConfig;
    db: DB;
    private constructor();
    static initialize(cfg?: MigrationConfig): Promise<Migration>;
    private log;
    /**
     * number of already applied migrations
     *
     * @returns {Promise<number>}
     */
    appliedMigrationsNum(): Promise<number>;
    private loadMigration;
    /**
     * @private
     * apply 1 migrations
     */
    private oneUp;
    /**
     * apply provided number of migrations
     *
     * @param {int} - optional number of migrations to apply, absent means all migrations
     * @returns {Promise<number>} - number of applied migrations
     */
    up(count?: number): Promise<number>;
    /**
     * @private
     * rollback 1 migrations
     */
    private oneDown;
    /**
     * @private
     * rollback provided list of migrations
     */
    private execDown;
    /**
     * rollbacks given number of migrations
     *
     * @param {int} count - number of migrations to rollback, absence or less than 1 will throw
     * @returns {Promise<number>} - number of migrations rolled back
     */
    down(count: number): Promise<number>;
    /**
     * rollbacks all migrations
     *
     * @returns {Promise<number>} - number of migrations rolled back
     */
    rollbackAll(): Promise<number>;
    /**
     * rollbacks last group of migrations
     *
     * @returns {Promise<number>} - number of migrations rolled back
     */
    rollbackGroup(): Promise<number>;
    /**
     * close DB connection and release pool
     */
    end(): Promise<void>;
}
/**
 * create migration file in format YYYYMMDD-HHMMSS-provided-file-name.js
 *
 * @param {string} - file name
 * @param {string} - directory name
 * @returns {Promise<string>} - name of the new file
 */
export declare const createMigrationFile: (name: string, dir?: string) => string;
