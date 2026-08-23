import { Pool } from 'pg';

const globalForPool = globalThis as unknown as {
  pool: Pool | undefined;
};

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL environment variable must be set');
    }
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

export const pool = globalForPool.pool ?? createPool();

if (process.env.NODE_ENV !== 'production') globalForPool.pool = pool;

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Query executed', { text: text.substring(0, 50), duration, rows: res.rowCount });
  }
  return res;
}
