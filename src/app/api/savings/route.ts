import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { jsonError, zodFail } from '@/lib/helpers/api';
import { savingsRequestSchema } from '@/lib/validation';
import { MONEY_EPSILON } from '@/lib/constants';
import {
  serializeSavingsRows,
  getCompletedSummary,
  getCompletedBalance,
  postStaffWithdrawal,
} from './_ledger';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';

/**
 * GET /api/savings — the caller's own ledger.
 * Returns { entries, balance, pendingWithdrawals } where balance counts only
 * COMPLETED rows (SUM(DEPOSIT) − SUM(WITHDRAWAL)).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError('Unauthorized', 401);

  try {
    const [listRes, summary] = await Promise.all([
      query(
        `SELECT * FROM savings WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [session.userId]
      ),
      getCompletedSummary(session.userId),
    ]);

    return NextResponse.json({
      entries: serializeSavingsRows(listRes.rows),
      balance: summary.balance,
      pendingWithdrawals: summary.pendingWithdrawals,
    });
  } catch (error) {
    console.error('GET /api/savings:', error);
    return jsonError('Failed to load savings ledger', 500);
  }
}

/**
 * POST /api/savings — deposits & withdrawals, discriminated by body.type.
 *
 * - MEMBER deposit            → PENDING (awaiting staff confirmation).
 * - MEMBER withdrawal         → PENDING (staff confirms via PATCH /api/savings/[id]).
 * - STAFF/ADMIN with userId   → recorded on behalf of that member, COMPLETED
 *                               immediately (withdrawals atomically balance-checked).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const parsed = savingsRequestSchema.safeParse(body);
  if (!parsed.success) return zodFail(parsed);

  const { type, amount } = parsed.data;
  const isStaff = session.role === 'STAFF' || session.role === 'ADMIN';
  const onBehalf = isStaff && typeof parsed.data.userId === 'string';
  const targetUserId = onBehalf ? (parsed.data.userId as string) : session.userId;

  try {
    /* ------------------------------ DEPOSIT ------------------------------ */
    if (type === 'DEPOSIT') {
      if (onBehalf) {
        const userRes = await query('SELECT id FROM users WHERE id = $1', [targetUserId]);
        if (userRes.rowCount === 0) return jsonError('Member not found', 404);

        const ins = await query(
          `INSERT INTO savings (user_id, amount, transaction_type, status, processed_by, processed_at)
           VALUES ($1, $2, 'DEPOSIT', 'COMPLETED', $3, NOW())
           RETURNING *`,
          [targetUserId, amount, session.userId]
        );
        const entry = serializeSavingsRows(ins.rows)[0];
        await audit(session.userId, 'SAVINGS_DEPOSIT_POSTED', 'savings', entry.id, {
          amount,
          userId: targetUserId,
        });
        await notify(
          targetUserId,
          'DEPOSIT_CONFIRMED',
          'Deposit posted',
          `A deposit of KES ${amount.toFixed(2)} was posted to your savings account.`,
          { savingsId: entry.id, amount }
        );
        return NextResponse.json(
          { entry, balanceAfter: await getCompletedBalance(targetUserId) },
          { status: 201 }
        );
      }

      const ins = await query(
        `INSERT INTO savings (user_id, amount, transaction_type, status)
         VALUES ($1, $2, 'DEPOSIT', 'PENDING')
         RETURNING *`,
        [targetUserId, amount]
      );
      const entry = serializeSavingsRows(ins.rows)[0];
      await audit(session.userId, 'SAVINGS_DEPOSIT_REQUESTED', 'savings', entry.id, { amount });
      return NextResponse.json(
        { entry, message: 'Deposit submitted — awaiting staff confirmation.' },
        { status: 201 }
      );
    }

    /* ---------------------------- WITHDRAWAL ----------------------------- */
    if (onBehalf) {
      const outcome = await postStaffWithdrawal(targetUserId, amount, session.userId);
      if (!outcome.ok) {
        if (outcome.reason === 'NOT_FOUND') return jsonError('Member not found', 404);
        if (outcome.reason === 'INSUFFICIENT_FUNDS') return jsonError('Insufficient balance', 409);
        return jsonError('Withdrawal could not be recorded', 409);
      }
      const entry = serializeSavingsRows([outcome.entry])[0];
      await audit(session.userId, 'SAVINGS_WITHDRAWAL_POSTED', 'savings', entry.id, {
        amount,
        userId: targetUserId,
      });
      await notify(
        targetUserId,
        'WITHDRAWAL_APPROVED',
        'Withdrawal processed',
        `A withdrawal of KES ${amount.toFixed(2)} was processed from your savings account.`,
        { savingsId: entry.id, amount }
      );
      return NextResponse.json({ entry, balanceAfter: outcome.balanceAfter }, { status: 201 });
    }

    // Member withdrawal request → always PENDING. Advisory early check against
    // confirmed balance minus other pending withdrawals; the authoritative
    // check runs atomically when staff confirm.
    const summary = await getCompletedSummary(targetUserId);
    if (amount > summary.balance - summary.pendingWithdrawals + MONEY_EPSILON) {
      return jsonError('Insufficient balance', 409);
    }

    const ins = await query(
      `INSERT INTO savings (user_id, amount, transaction_type, status)
       VALUES ($1, $2, 'WITHDRAWAL', 'PENDING')
       RETURNING *`,
      [targetUserId, amount]
    );
    const entry = serializeSavingsRows(ins.rows)[0];
    await audit(session.userId, 'SAVINGS_WITHDRAWAL_REQUESTED', 'savings', entry.id, { amount });
    return NextResponse.json(
      { entry, message: 'Withdrawal requested — awaiting staff confirmation.' },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/savings:', error);
    return jsonError('Failed to record savings transaction', 500);
  }
}
