/**
 * Savings ledger internals shared by /api/savings routes.
 *
 * Balance invariant: a member's balance is SUM(DEPOSIT) - SUM(WITHDRAWAL)
 * over status='COMPLETED' rows. Every mutation that can reduce that balance
 * runs inside an explicit transaction on a checked-out client and serializes
 * per member via `SELECT ... FOR UPDATE` on the member's users row, so two
 * concurrent confirmations can never both pass the balance check.
 */
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import { MONEY_EPSILON } from '@/lib/constants';
import { round2 } from '@/lib/format';

export interface SavingsRow {
  id: string;
  user_id: string;
  amount: string; // pg returns DECIMAL as string
  transaction_type: 'DEPOSIT' | 'WITHDRAWAL';
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  processed_by: string | null;
  processed_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
}

export type SerializedSavingsEntry = Omit<SavingsRow, 'amount'> & { amount: number };

/**
 * Convert pg DECIMAL strings to numbers at the serialization boundary.
 * Everything else (snake_case columns, ISO dates) passes through unchanged,
 * matching the raw-row convention of the other APIs in this repo.
 */
export function serializeSavingsRows(rows: Array<Record<string, unknown>>): SerializedSavingsEntry[] {
  return rows.map((row) => ({
    ...(row as unknown as SavingsRow),
    amount: Number(row.amount),
  }));
}

/** Run `fn` inside BEGIN/COMMIT on a checked-out client; ROLLBACK on throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken — nothing to roll back
    }
    throw error;
  } finally {
    client.release();
  }
}

const COMPLETED_BALANCE_SQL = `
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END), 0) AS balance
  FROM savings
  WHERE user_id = $1 AND status = 'COMPLETED'`;

/** Completed-ledger balance for a member. */
export async function getCompletedBalance(userId: string): Promise<number> {
  const res = await pool.query(COMPLETED_BALANCE_SQL, [userId]);
  return Number(res.rows[0]?.balance ?? 0);
}

/** Balance + total value of still-PENDING withdrawals (for UI hints). */
export async function getCompletedSummary(
  userId: string
): Promise<{ balance: number; pendingWithdrawals: number }> {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND transaction_type = 'DEPOSIT' THEN amount
                         WHEN status = 'COMPLETED' THEN -amount
                         ELSE 0 END), 0) AS balance,
       COALESCE(SUM(CASE WHEN status = 'PENDING' AND transaction_type = 'WITHDRAWAL' THEN amount
                         ELSE 0 END), 0) AS pending_withdrawals
     FROM savings
     WHERE user_id = $1`,
    [userId]
  );
  return {
    balance: Number(res.rows[0]?.balance ?? 0),
    pendingWithdrawals: Number(res.rows[0]?.pending_withdrawals ?? 0),
  };
}

export type WithdrawalOutcome =
  | { ok: true; entry: Record<string, unknown>; balanceAfter: number }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_PROCESSED' | 'INSUFFICIENT_FUNDS' };

/**
 * Atomically complete a PENDING withdrawal iff the member's completed-ledger
 * balance covers it. Lock order is always users-row → savings-row so
 * concurrent confirmations serialize without deadlocking.
 */
export async function completeWithdrawalAtomically(
  savingsId: string,
  processedBy: string
): Promise<WithdrawalOutcome> {
  return withTransaction(async (client) => {
    const entryRes = await client.query<SavingsRow>('SELECT * FROM savings WHERE id = $1', [
      savingsId,
    ]);
    if (entryRes.rows.length === 0) return { ok: false as const, reason: 'NOT_FOUND' as const };
    const entry = entryRes.rows[0];
    if (entry.status !== 'PENDING') {
      return { ok: false as const, reason: 'ALREADY_PROCESSED' as const };
    }

    // Serialize all balance mutations for this member.
    const lockRes = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
      entry.user_id,
    ]);
    if (lockRes.rowCount === 0) return { ok: false as const, reason: 'NOT_FOUND' as const };

    const balRes = await client.query(COMPLETED_BALANCE_SQL, [entry.user_id]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);
    const amount = Number(entry.amount);
    if (amount > balance + MONEY_EPSILON) {
      return { ok: false as const, reason: 'INSUFFICIENT_FUNDS' as const };
    }

    const upd = await client.query(
      `UPDATE savings SET status = 'COMPLETED', processed_by = $2, processed_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
      [savingsId, processedBy]
    );
    if (!upd.rows[0]) return { ok: false as const, reason: 'ALREADY_PROCESSED' as const };

    return { ok: true as const, entry: upd.rows[0], balanceAfter: round2(balance - amount) };
  });
}

/**
 * STAFF/ADMIN records + completes a withdrawal on behalf of a member in one
 * atomic step (balance check and insert happen under the same member lock).
 */
export async function postStaffWithdrawal(
  userId: string,
  amount: number,
  processedBy: string
): Promise<WithdrawalOutcome> {
  return withTransaction(async (client) => {
    const lockRes = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (lockRes.rowCount === 0) return { ok: false as const, reason: 'NOT_FOUND' as const };

    const balRes = await client.query(COMPLETED_BALANCE_SQL, [userId]);
    const balance = Number(balRes.rows[0]?.balance ?? 0);
    if (amount > balance + MONEY_EPSILON) {
      return { ok: false as const, reason: 'INSUFFICIENT_FUNDS' as const };
    }

    const ins = await client.query(
      `INSERT INTO savings (user_id, amount, transaction_type, status, processed_by, processed_at)
       VALUES ($1, $2, 'WITHDRAWAL', 'COMPLETED', $3, NOW())
       RETURNING *`,
      [userId, amount, processedBy]
    );
    return { ok: true as const, entry: ins.rows[0], balanceAfter: round2(balance - amount) };
  });
}
