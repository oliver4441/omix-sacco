import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { audit } from '@/lib/audit';
import { notify } from '@/lib/notify';
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  member_no: string | null;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'STAFF' | 'MEMBER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DORMANT';
  created_at: Date;
}

function mapProfile(r: UserRow) {
  return {
    id: r.id,
    memberNo: r.member_no,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    status: r.status,
    joined: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

/**
 * GET /api/members/[id]   (STAFF, ADMIN — or the member themself)
 * Profile + balances + loan history summary + recent savings entries.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  const { id } = await params;
  const isStaff = !!session && (session.role === 'ADMIN' || session.role === 'STAFF');
  if (!session || (!isStaff && session.userId !== id)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid member id' }, { status: 400 });
  }

  try {
    const userResult = await query(
      `SELECT id, member_no, full_name, email, phone, role, status, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const [balancesResult, loanSummaryResult, recentSavingsResult] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END), 0)
             AS savings_balance
         FROM savings WHERE user_id = $1 AND status = 'COMPLETED'`,
        [id]
      ),
      query(
        `SELECT COUNT(*)::int AS total_loans,
                COUNT(*) FILTER (WHERE status IN ('PENDING', 'APPROVED', 'DISBURSED'))::int AS active_loans,
                COALESCE(SUM(amount) FILTER (WHERE status IN ('PENDING', 'APPROVED', 'DISBURSED')), 0)
                  AS outstanding_total
         FROM loans WHERE user_id = $1`,
        [id]
      ),
      query(
        `SELECT id, amount, transaction_type, status, created_at
         FROM savings WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [id]
      ),
    ]);

    const savings = balancesResult.rows[0];
    const loans = loanSummaryResult.rows[0];

    return NextResponse.json({
      member: mapProfile(userResult.rows[0] as UserRow),
      savingsBalance: Number(savings?.savings_balance ?? 0),
      activeLoanTotal: Number(loans?.outstanding_total ?? 0),
      loanSummary: {
        totalLoans: Number(loans?.total_loans ?? 0),
        activeLoans: Number(loans?.active_loans ?? 0),
        outstandingTotal: Number(loans?.outstanding_total ?? 0),
      },
      recentSavings: (recentSavingsResult.rows as Array<Record<string, unknown>>).map((s) => ({
        id: s.id as string,
        amount: Number(s.amount),
        transactionType: s.transaction_type as string,
        status: s.status as string,
        createdAt:
          s.created_at instanceof Date
            ? (s.created_at as Date).toISOString()
            : (s.created_at as string),
      })),
    });
  } catch (error) {
    console.error('GET /api/members/[id]:', error);
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 });
  }
}

const patchSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DORMANT']).optional(),
    role: z.enum(['MEMBER', 'STAFF', 'ADMIN']).optional(),
  })
  .refine((data) => data.status !== undefined || data.role !== undefined, {
    message: 'Provide a status and/or role to update',
  });

/**
 * PATCH /api/members/[id]   (ADMIN only)
 * Body: { status?, role? }. Guards the last ADMIN from demotion/suspension.
 * Audited; the affected user is notified in-app.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid member id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { status, role } = parsed.data;

  try {
    const currentResult = await query(
      'SELECT id, role, status FROM users WHERE id = $1',
      [id]
    );
    if (currentResult.rows.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    const current = currentResult.rows[0] as Pick<UserRow, 'role' | 'status'>;

    const nextRole = role ?? current.role;
    const nextStatus = status ?? current.status;

    // Last-admin guard: an ADMIN losing access via demotion OR suspension.
    // Only *ACTIVE* admins count as remaining — a suspended/dormant admin
    // cannot log in and would leave the SACCO without reachable admin.
    if (
      current.role === 'ADMIN' &&
      (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE')
    ) {
      const others = await query(
        `SELECT COUNT(*)::int AS n FROM users
         WHERE role = 'ADMIN' AND id <> $1 AND status = 'ACTIVE'`,
        [id]
      );
      if ((others.rows[0]?.n ?? 0) === 0) {
        return NextResponse.json(
          { error: 'Cannot demote or suspend the last ADMIN. Promote another admin first.' },
          { status: 409 }
        );
      }
    }

    const updated = await query(
      `UPDATE users SET role = $2, status = $3
       WHERE id = $1
       RETURNING id, member_no, full_name, email, phone, role, status, created_at`,
      [id, nextRole, nextStatus]
    );

    // Audit after the write succeeds; never block the response on it.
    await audit(session.userId, 'MEMBER_UPDATE', 'user', id, {
      changes: {
        ...(status !== undefined && status !== current.status
          ? { status: { from: current.status, to: status } }
          : {}),
        ...(role !== undefined && role !== current.role
          ? { role: { from: current.role, to: role } }
          : {}),
      },
    });

    // Notify the affected user about material changes.
    if (status !== undefined && status !== current.status) {
      if (status === 'SUSPENDED') {
        await notify(
          id,
          'ACCOUNT_SUSPENDED',
          'Account suspended',
          'Your Omix SACCO account has been suspended. Please contact the SACCO administrator.',
          { by: session.userId }
        );
      } else if (current.status === 'SUSPENDED' && status === 'ACTIVE') {
        await notify(
          id,
          'ACCOUNT_REACTIVATED',
          'Account reactivated',
          'Your Omix SACCO account has been reactivated. Welcome back!',
          { by: session.userId }
        );
      } else {
        await notify(
          id,
          'ACCOUNT_STATUS_UPDATED',
          'Account status updated',
          `Your Omix SACCO account status is now ${status}.`,
          { by: session.userId, status }
        );
      }
    }
    if (role !== undefined && role !== current.role) {
      await notify(
        id,
        'ROLE_UPDATED',
        'Account role updated',
        `Your Omix SACCO account role was changed to ${role}.`,
        { by: session.userId, role }
      );
    }

    return NextResponse.json({ member: mapProfile(updated.rows[0] as UserRow) });
  } catch (error) {
    console.error('PATCH /api/members/[id]:', error);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}
