import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { jsonError, zodFail } from '@/lib/helpers/api';
import { withdrawalSchema } from '@/lib/validation';
import { MONEY_EPSILON } from '@/lib/constants';
import { serializeSavingsRows, getCompletedSummary } from '../_ledger';
import { audit } from '@/lib/audit';

const bodySchema = withdrawalSchema.omit({ type: true });

/**
 * POST /api/savings/withdraw — member withdrawal REQUEST.
 *
 * Confirmation flow: the request is inserted as PENDING; staff complete it via
 * PATCH /api/savings/[id] { action: 'CONFIRM' }, which re-checks the balance
 * atomically (SELECT ... FOR UPDATE) so a confirmation can never drive the
 * member's completed-ledger balance negative. This endpoint performs an
 * advisory early check so members get instant feedback on available funds
 * (confirmed balance minus other pending withdrawals).
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return zodFail(parsed);
  const { amount } = parsed.data;

  try {
    const summary = await getCompletedSummary(session.userId);
    const available = summary.balance - summary.pendingWithdrawals;
    if (amount > available + MONEY_EPSILON) {
      return jsonError('Insufficient balance', 409);
    }

    const ins = await query(
      `INSERT INTO savings (user_id, amount, transaction_type, status)
       VALUES ($1, $2, 'WITHDRAWAL', 'PENDING')
       RETURNING *`,
      [session.userId, amount]
    );
    const entry = serializeSavingsRows(ins.rows)[0];

    await audit(session.userId, 'SAVINGS_WITHDRAWAL_REQUESTED', 'savings', entry.id, {
      amount,
      availableAtRequest: available,
    });

    return NextResponse.json(
      {
        entry,
        available,
        message: 'Withdrawal requested — awaiting staff confirmation.',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/savings/withdraw:', error);
    return jsonError('Failed to submit withdrawal request', 500);
  }
}
