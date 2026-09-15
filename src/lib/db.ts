import pg from 'pg';

/**
 * Postgres connection pool.
 *
 * Server-only. This module must never reach a browser bundle — the database is
 * on the stack's private `net_data` network with no published port, and the
 * only thing allowed to talk to it is this app server. That is the whole reason
 * the schema has no row-level security: isolation is enforced here, by every
 * query being scoped to the signed-in user, rather than by the database
 * second-guessing a client it can no longer see.
 */

// numeric/int8 come back as strings by default so no precision is lost on the
// wire. Every numeric column here is money or a share count that the app treats
// as a JS number, so parse them once, centrally, rather than in each caller.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8

function env(key: string): string | undefined {
  return import.meta.env[key] ?? process.env[key];
}

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (pool) return pool;

  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // A pool error is emitted for idle clients dropped by the server. Without a
  // listener, node treats it as an unhandled 'error' event and exits the
  // process — taking the whole app down because a connection went stale.
  pool.on('error', (err) => console.error('[db] idle client error:', err));

  return pool;
}

/** Run a query and return its rows. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await db().query(text, params);
  return res.rows as T[];
}

/** Run a query expected to match at most one row. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
