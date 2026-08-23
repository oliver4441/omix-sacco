import { Pool } from 'pg';

const globalForPool = globalThis as unknown as {
  pool: Pool | undefined;
};

/**
 * Pool creation is LAZY: `new Pool()` is deferred until the first query.
 * This keeps `next build` working in environments without DATABASE_URL
 * (page-data collection imports route modules but never executes queries).
 */
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.warn('[db] DATABASE_URL is not set — queries will fail until it is provided.');
  }

  // Hosted providers like Neon require TLS. Plain local databases
  // (localhost / 127.0.0.1) usually do NOT support SSL, so skip it there.
  const isLocal =
    !!connectionString && /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

  return new Pool({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export function getPool(): Pool {
  if (!globalForPool.pool) globalForPool.pool = createPool();
  return globalForPool.pool;
}

/** Kept for backwards compatibility with existing `import { pool }` call sites. */
export const pool = new Proxy({} as Pool, {
  get(_target, prop, receiver) {
    return Reflect.get(getPool(), prop, receiver);
  },
});

export async function query(text: string, params?: unknown[]) {
  const pool = getPool();
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Query executed', { text: text.substring(0, 50), duration, rows: res.rowCount });
  }
  return res;
}
