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
    up?: (t: T.ITask<{}>) => Promise<void>;
    down?: (t: T.ITask<{}>) => Promise<void>;
} & Record<string, unknown>;
export declare class Migration {
    config: MigrationConfig;
    db: DB;
    log: (...args: any[]) => void;
    error: (...args: any[]) => void;
    private constructor();
    static initialize(cfg?: MigrationConfig): Promise<Migration>;
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
     * @param {number} count - optional number of migrations to apply, absent or 0 means all migrations
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of applied migrations
     */
    up(count?: number, dry?: boolean): Promise<number>;
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
     * @param {number} count - number of migrations to rollback, absence or less than 1 will throw
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of migrations rolled back
     */
    down(count: number, dry?: boolean): Promise<number>;
    /**
     * rollbacks all migrations
     *
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of migrations rolled back
     */
    rollbackAll(dry?: boolean): Promise<number>;
    /**
     * rollbacks last group of migrations
     *
     * @param {boolean} dry - dry run mode, optional, false by default
     * @returns {Promise<number>} - number of migrations rolled back
     */
    rollbackGroup(dry?: boolean): Promise<number>;
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
