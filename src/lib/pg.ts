import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * One database interface, two backends.
 *
 *   DATABASE_URL set  ->  real Postgres over the wire (Supabase on Vercel)
 *   DATABASE_URL unset ->  PGlite, an embedded Postgres that lives in ./data
 *
 * Both are genuinely PostgreSQL, so the SQL is identical and local development
 * needs no account, no server and no network.
 */

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  /** All matching rows. */
  many<T>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script. Prepared statements accept only one
   *  command, so schema files must go through here, never through run(). */
  exec(sql: string): Promise<void>;
  /** First row, or null. */
  one<T>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Statement with no useful result. */
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Runs fn inside a transaction, rolling back if it throws. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

/**
 * Lets the whole codebase keep writing `?` placeholders while Postgres gets the
 * `$1, $2 …` it expects.
 *
 * Question marks inside SQL string literals would be rewritten too, so no query
 * in this project may contain one. There are none, and the seed/tests would fail
 * loudly if that ever changed.
 */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const DATA_DIR = path.join(process.cwd(), 'data');
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.pg.sql');

/* ------------------------------------------------------------------ */
/* Backends                                                            */
/* ------------------------------------------------------------------ */

type AnyClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  /** PGlite exposes exec() for scripts; node-postgres uses query() with no params. */
  exec?: (sql: string) => Promise<unknown>;
};

function wrap(client: AnyClient, beginTx: (fn: (db: Db) => Promise<unknown>) => Promise<unknown>): Db {
  const db: Db = {
    async many<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(toPgPlaceholders(sql), params);
      return ((res.rows[0] as T) ?? null) as T | null;
    },
    async run(sql: string, params: unknown[] = []) {
      await client.query(toPgPlaceholders(sql), params);
    },
    async exec(sql: string) {
      // No placeholder rewriting: scripts carry no parameters, and a stray
      // "?" inside one would be mangled.
      if (client.exec) await client.exec(sql);
      else await client.query(sql);
    },
    tx<T>(fn: (d: Db) => Promise<T>) {
      return beginTx(fn as (d: Db) => Promise<unknown>) as Promise<T>;
    },
  };
  return db;
}

declare global {
  // eslint-disable-next-line no-var
  var __flow_db_promise__: Promise<Db> | undefined;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;

  if (url) {
    // --- hosted Postgres (Supabase) ---
    const pgModule = await import('pg');
    const { Pool, types } = pgModule.default ?? pgModule;

    /*
     * node-postgres hands back BIGINT as a string, because a 64-bit integer can
     * exceed Number.MAX_SAFE_INTEGER. Every BIGINT here is a Date.now()
     * millisecond value (~1.7e12), far inside the safe range — and PGlite
     * already returns them as numbers. Parsing here keeps both backends
     * identical instead of leaving "1735689600000" to poison date maths.
     */
    types.setTypeParser(20, (v: string) => parseInt(v, 10));
    const pool = new Pool({
      connectionString: url,
      // Supabase terminates TLS with its own CA; verifying it from a serverless
      // function needs the cert bundled, which is more trouble than it is worth
      // for a connection that never leaves the provider's network.
      ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
      /*
       * Hydrating a board issues its queries as one batch. With a pool this
       * small they queue into several sequential waves instead, and every
       * wave costs a full round trip — so the pool size directly sets how
       * slow a page feels. Supabase's transaction pooler (port 6543) is
       * built to multiplex many client connections, so a modest pool is
       * safe; lower PG_POOL_MAX if the project reports connection pressure.
       */
      max: Number(process.env.PG_POOL_MAX ?? 8),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });

    const root = wrap(pool as unknown as AnyClient, async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const scoped = wrap(client as unknown as AnyClient, async (inner) => inner(scoped));
        const out = await fn(scoped);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    });

    await migrate(root);
    return root;
  }

  // --- embedded Postgres for local development ---
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = await PGlite.create({ dataDir: path.join(DATA_DIR, 'pg') });

  const root = wrap(lite as unknown as AnyClient, async (fn) => {
    // PGlite is single-connection, so a transaction is just BEGIN/COMMIT here.
    await lite.query('BEGIN');
    try {
      const out = await fn(root);
      await lite.query('COMMIT');
      return out;
    } catch (err) {
      await lite.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });

  await migrate(root);
  return root;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

async function migrate(db: Db) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');

  /*
   * The schema is entirely CREATE ... IF NOT EXISTS, so re-running it is
   * always safe. It is not always cheap: every cold start would otherwise
   * pay for a few dozen catalog checks before serving its first request,
   * and serverless cold-starts often. Stamping the applied schema lets an
   * unchanged one be skipped, while any edit to the file re-applies itself
   * automatically — no migration files to write or remember.
   *
   * Every failure path falls through to applying the schema, so the worst
   * a bad stamp can cost is the work this was meant to save.
   */
  const stamp = createHash('sha1').update(sql).digest('hex');

  try {
    await db.run(
      'CREATE TABLE IF NOT EXISTS schema_meta (id INT PRIMARY KEY, applied TEXT NOT NULL)'
    );
    const row = await db.one<{ applied: string }>('SELECT applied FROM schema_meta WHERE id = 1');
    if (row?.applied === stamp) return;
  } catch {
    // First run, or the marker is unreadable — fall through and apply.
  }

  await db.exec(sql);
  await db.run(
    `INSERT INTO schema_meta (id, applied) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET applied = EXCLUDED.applied`,
    [stamp]
  );
}

/** Opened once per process, lazily. */
export function getDb(): Promise<Db> {
  if (!global.__flow_db_promise__) global.__flow_db_promise__ = connect();
  return global.__flow_db_promise__;
}

/* ------------------------------------------------------------------ */
/* Convenience wrappers used throughout the store                      */
/* ------------------------------------------------------------------ */

export async function many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await getDb()).many<T>(sql, params);
}

export async function one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await getDb()).one<T>(sql, params);
}

export async function run(sql: string, params: unknown[] = []): Promise<void> {
  return (await getDb()).run(sql, params);
}

export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return (await getDb()).tx(fn);
}

/** Next human-facing task number, allocated atomically. */
export async function nextTaskSeq(): Promise<number> {
  const row = await one<{ value: number }>(
    `INSERT INTO counters (name, value) VALUES ('task_seq', 1)
     ON CONFLICT (name) DO UPDATE
       SET value = GREATEST(counters.value, (SELECT COALESCE(MAX(seq), 0) FROM tasks)) + 1
     RETURNING value`
  );
  return Number(row?.value ?? 1);
}
