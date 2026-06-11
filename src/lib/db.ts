import { Pool } from 'pg';

const globalForPool = globalThis as unknown as {
  pool: Pool | undefined;
};

export const pool =
  globalForPool.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

if (process.env.NODE_ENV !== 'production') globalForPool.pool = pool;

export async function query(text: string, params?: unknown[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Query executed', { text: text.substring(0, 50), duration, rows: res.rowCount });
  return res;
}
