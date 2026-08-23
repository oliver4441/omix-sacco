/**
 * /api/loans
 *   GET  — STAFF/ADMIN: paginated, filterable loan list w/ server-computed
 *          eligibility aggregates for the review UI.
 *   POST — MEMBER+: create a PENDING loan application. Server recomputes the
 *          interest rate from constants (client value ignored — fixes BUG-C),
 *          enforces savings/limit rules up-front and attaches guarantor rows.
 *
 * REQUIRED MIGRATION: prisma/migrations/002_phase1_core.sql (see
 * src/lib/loan-schedule.ts header for the exact SQL) — adds users.status /
 * users.member_no, loan lifecycle columns, guarantors.guaranteed_amount and
 * the loan_repayments table used by the rest of the lifecycle.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  SACCO,
  LOAN_STATUSES,
  createLoanSchema,
  zodFail,
  jsonError,
  HttpError,
  isUniqueViolation,
  withTransaction,
  getSavingsBalance,
  getGuarantorFreeCapacity,
  resolveMemberByIdentifier,
  termsForLoan,
  notify,
  audit,
  type QueryExecutor,
} from '@/lib/loan-helpers';

const PAGE_SIZE_CAP = 100;
/** Pool-backed executor for helpers that also run inside transactions. */
const db: QueryExecutor = { query: (text, params) => query(text, params) };

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== 'ADMIN' && session.role !== 'STAFF')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const q = searchParams.get('q')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      PAGE_SIZE_CAP,
      Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10) || 20)
    );
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const params: unknown[] = [];

    if (status) {
      if (!(LOAN_STATUSES as readonly string[]).includes(status)) {
        return jsonError(`Invalid status filter — allowed: ${LOAN_STATUSES.join(', ')}`, 400);
      }
      params.push(status);
      where.push(`l.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.member_no ILIKE $${params.length})`
      );
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    // Lateral subqueries surface everything the staff review UI renders as
    // pass/fail chips without N+1 round trips.
    const listSql = `
      SELECT l.*, u.full_name AS user_name, u.email AS user_email,
             u.member_no AS member_no, u.status AS member_status,
             COALESCE(s.savings_balance, 0) AS savings_balance,
             COALESCE(g.approved_count, 0) AS approved_guarantor_count,
             COALESCE(g.approved_amount, 0) AS approved_guarantor_amount,
             COALESCE(a.active_count, 0) AS other_active_loan_count
      FROM loans l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END), 0) AS savings_balance
        FROM savings WHERE user_id = u.id AND status = 'COMPLETED'
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS approved_count, COALESCE(SUM(guaranteed_amount), 0) AS approved_amount
        FROM guarantors WHERE loan_id = l.id AND status = 'APPROVED'
      ) g ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_count FROM loans l2
        WHERE l2.user_id = l.user_id AND l2.id <> l.id AND l2.status IN ('PENDING','APPROVED','DISBURSED')
      ) a ON true
      ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSql = `
      SELECT COUNT(*)::int AS total FROM loans l JOIN users u ON u.id = l.user_id ${whereSql}
    `;

    const [listRes, countRes] = await Promise.all([
      query(listSql, [...params, pageSize, offset]),
      query(countSql, params),
    ]);

    return NextResponse.json({
      loans: listRes.rows,
      total: Number(countRes.rows[0]?.total ?? 0),
      page,
      pageSize,
    });
  } catch (error) {
    console.error('Error fetching loans:', error);
    return NextResponse.json({ error: 'Failed to fetch loans' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = createLoanSchema.safeParse(body);
    if (!parsed.success) return zodFail(parsed);

    const { amount, durationMonths, purpose, loanType } = parsed.data;
    const guarantorInputs = parsed.data.guarantors ?? [];

    // Interest rate ALWAYS comes from constants; any client value is ignored.
    const terms = termsForLoan(amount, durationMonths);

    // ── Borrower checks ──
    const borrowerRes = await query(
      `SELECT id, email, full_name, status, member_no FROM users WHERE id = $1`,
      [session.userId]
    );
    const borrower = borrowerRes.rows[0];
    if (!borrower) return jsonError('Borrower account not found', 404);
    if ((borrower.status ?? 'ACTIVE') !== 'ACTIVE') {
      return jsonError('Account must be ACTIVE to apply for a loan', 400);
    }

    const balance = await getSavingsBalance(db, session.userId);

    if (balance < SACCO.MIN_SAVINGS_TO_BORROW) {
      return jsonError(
        `A minimum savings balance of KES ${SACCO.MIN_SAVINGS_TO_BORROW.toLocaleString()} is required to borrow (current: KES ${balance.toLocaleString()})`,
        400
      );
    }
    const maxLoan = SACCO.LOAN_LIMIT_MULTIPLE_OF_SAVINGS * balance;
    if (amount > maxLoan) {
      return jsonError(
        `Requested KES ${amount.toLocaleString()} exceeds your limit of KES ${Math.round(maxLoan).toLocaleString()} (${SACCO.LOAN_LIMIT_MULTIPLE_OF_SAVINGS} × confirmed savings)`,
        400
      );
    }

    const activeRes = await query(
      `SELECT COUNT(*)::int AS c FROM loans WHERE user_id = $1 AND status IN ('PENDING','APPROVED','DISBURSED')`,
      [session.userId]
    );
    if (Number(activeRes.rows[0]?.c ?? 0) >= SACCO.MAX_ACTIVE_LOANS_PER_MEMBER) {
      return jsonError(
        `You may hold at most ${SACCO.MAX_ACTIVE_LOANS_PER_MEMBER} non-terminal loan application at a time`,
        400
      );
    }

    // ── Guarantor resolution & capacity pre-checks (all before any write) ──
    interface GuarantorPlan {
      guarantorId: string;
      guaranteedAmount: number;
      name: string;
      email: string;
    }
    const plans: GuarantorPlan[] = [];
    const seenIds = new Set<string>();

    for (const input of guarantorInputs) {
      const member = await resolveMemberByIdentifier(input.identifier);
      if (!member) {
        return jsonError(`Guarantor "${input.identifier}" not found`, 404);
      }
      if (member.id === session.userId) {
        return jsonError('You cannot guarantee your own loan', 400);
      }
      if ((member.status ?? 'ACTIVE') !== 'ACTIVE') {
        return jsonError(`Guarantor "${input.identifier}" does not have an ACTIVE account`, 400);
      }
      if (seenIds.has(member.id)) {
        return jsonError(`Duplicate guarantor entry for "${input.identifier}"`, 409);
      }
      seenIds.add(member.id);

      const freeCapacity = await getGuarantorFreeCapacity(db, member.id);
      const maxPledge = Math.min(freeCapacity, amount);
      if (input.guaranteedAmount > maxPledge + 1e-9) {
        return jsonError(
          `${member.full_name || member.email} can only guarantee up to KES ${maxPledge.toLocaleString()} (free capacity: savings minus existing pledges, capped at this loan's principal)`,
          400
        );
      }
      plans.push({
        guarantorId: member.id,
        guaranteedAmount: input.guaranteedAmount,
        name: member.full_name || member.email,
        email: member.email,
      });
    }

    // ── Persist loan + guarantor rows atomically ──
    let created;
    try {
      created = await withTransaction(async (tx) => {
        const loanRes = await tx.query(
          `INSERT INTO loans (user_id, amount, interest_rate, duration_months, purpose, status, loan_type)
           VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
           RETURNING *`,
          [session.userId, amount, terms.interestRatePct, durationMonths, purpose ?? null, loanType]
        );
        const loan = loanRes.rows[0];

        for (const plan of plans) {
          await tx.query(
            `INSERT INTO guarantors (loan_id, guarantor_id, status, guaranteed_amount)
             VALUES ($1, $2, 'PENDING', $3)`,
            [loan.id, plan.guarantorId, plan.guaranteedAmount]
          );
        }
        return loan;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return jsonError('One of the selected guarantors is already attached to this loan', 409);
      }
      throw error;
    }

    // ── Side effects (best-effort, after commit) ──
    for (const plan of plans) {
      notify(
        plan.guarantorId,
        'GUARANTOR_REQUEST',
        'Guarantor request',
        `${borrower.full_name || borrower.email} requested you to guarantee KES ${plan.guaranteedAmount.toLocaleString()}. Respond in your dashboard.`,
        { loanId: created.id, amount: plan.guaranteedAmount }
      );
    }
    await audit(session.userId, 'LOAN_APPLY', 'loan', String(created.id ?? ''), {
      amount,
      durationMonths,
      loanType,
      guarantors: plans.map((p) => p.guarantorId),
    });

    return NextResponse.json(
      {
        loan: created,
        termsPreview: {
          interestRatePct: terms.interestRatePct,
          totalInterest: terms.totalInterest,
          totalPayable: terms.totalPayable,
          monthlyInstallment: terms.monthlyInstallment,
        },
        guarantors: plans.map((p) => ({
          guarantor_id: p.guarantorId,
          name: p.name,
          guaranteed_amount: p.guaranteedAmount,
          status: 'PENDING',
        })),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.message, error.status);
    console.error('Error creating loan:', error);
    return NextResponse.json({ error: 'Failed to create loan' }, { status: 500 });
  }
}

