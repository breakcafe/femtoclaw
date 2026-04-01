/**
 * SQLite compatibility layer.
 *
 * Detects the runtime (Node.js vs Bun) and provides a unified Database
 * interface backed by better-sqlite3 (Node) or bun:sqlite (Bun).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface Database {
  pragma(pragma: string): unknown;
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
  transaction<T>(fn: () => T): () => T;
}

const isBun = 'Bun' in globalThis;

// Resolve the underlying driver once at module load
let _driver: any;

if (isBun) {
  // Use a variable to prevent tsc from resolving the bun-only module
  const bunModule = 'bun:sqlite';
  _driver = await import(bunModule);
} else {
  _driver = await import('better-sqlite3');
}

function wrapBunDatabase(path: string): Database {
  const BunDB = _driver.Database ?? _driver.default;
  const db = new BunDB(path);

  return {
    pragma(p: string): unknown {
      return db.run(`PRAGMA ${p}`);
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]): RunResult {
          stmt.run(...params);
          const row = db.query('SELECT changes() as c').get() as { c: number } | null;
          return { changes: row?.c ?? 0, lastInsertRowid: 0 };
        },
        get(...params: unknown[]): any {
          return stmt.get(...params);
        },
        all(...params: unknown[]): any[] {
          return stmt.all(...params);
        },
      };
    },
    close(): void {
      db.close();
    },
    transaction<T>(fn: () => T): () => T {
      return db.transaction(fn) as () => T;
    },
  };
}

function wrapBetterSqlite3(path: string): Database {
  const NodeDB = _driver.default ?? _driver;
  const db = new NodeDB(path);

  return {
    pragma(p: string): unknown {
      return db.pragma(p);
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]): RunResult {
          const result = stmt.run(...params);
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        get(...params: unknown[]): any {
          return stmt.get(...params);
        },
        all(...params: unknown[]): any[] {
          return stmt.all(...params);
        },
      };
    },
    close(): void {
      db.close();
    },
    transaction<T>(fn: () => T): () => T {
      return db.transaction(fn);
    },
  };
}

export function createDatabase(path: string): Database {
  return isBun ? wrapBunDatabase(path) : wrapBetterSqlite3(path);
}
