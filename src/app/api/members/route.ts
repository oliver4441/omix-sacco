import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

// Whitelisted user status values (must match the DB CHECK constraint).
const STATUSES = new Set(['ACTIVE', 'SUSPENDED', 'DORMANT']);

function parseIntSafe(value: string | null, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

interface MemberDbRow {
  id: string;
  member_no: string | null;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'STAFF' | 'MEMBER';
  status: 'ACTIVE' | 'SUSPENDED' | 'DORMANT';
  created_at: Date;
  savings_balance: string | number | null;
  active_loan_total: string | number | null;
}

// pg returns DECIMAL/SUM as strings; convert at the serialization boundary only.
function mapMemberRow(r: MemberDbRow) {
  return {
    id: r.id,
    memberNo: r.member_no,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    status: r.status,
    joined: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    savingsBalance: Number(r.savings_balance ?? 0),
    activeLoanTotal: Number(r.active_loan_total ?? 0),
  };
}

/**
 * GET /api/members?q=&status=&page=&pageSize=   (STAFF, ADMIN)
 * Member directory with computed savings balance and outstanding loan total
 * per member. Pagination capped at 100/page.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== 'ADMIN' && session.role !== 'STAFF')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || null;
    const statusParam = searchParams.get('status');
    const status = statusParam && STATUSES.has(statusParam) ? statusParam : null;

    if (statusParam && !STATUSES.has(statusParam)) {
      return NextResponse.json(
        { error: 'Invalid status filter. Use ACTIVE, SUSPENDED or DORMANT.' },
        { status: 400 }
      );
    }

    const page = Math.max(1, parseIntSafe(searchParams.get('page'), 1));
    const pageSize = Math.min(100, Math.max(1, parseIntSafe(searchParams.get('pageSize'), 20)));
    const offset = (page - 1) * pageSize;

    // Build the WHERE clause dynamically with parameterized inputs only.
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (q) {
      params.push(`%${q}%`);
      const i = params.length;
      conditions.push(`(u.full_name ILIKE $${i} OR u.email ILIKE $${i} OR u.member_no ILIKE $${i})`);
    }
    if (status) {
      params.push(status);
      conditions.push(`u.status = $${params.length}`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereSql}`,
      params
    );
    const total: number = countResult.rows[0]?.total ?? 0;

    const rowsResult = await query(
      `SELECT u.id, u.member_no, u.full_name, u.email, u.phone, u.role, u.status, u.created_at,
              COALESCE(s.savings_balance, 0) AS savings_balance,
              COALESCE(l.active_loan_total, 0) AS active_loan_total
       FROM users u
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END) AS savings_balance
         FROM savings
         WHERE user_id = u.id AND status = 'COMPLETED'
       ) s ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS active_loan_total
         FROM loans
         WHERE user_id = u.id AND status IN ('PENDING', 'APPROVED', 'DISBURSED')
       ) l ON TRUE
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    return NextResponse.json({
      members: (rowsResult.rows as MemberDbRow[]).map(mapMemberRow),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('GET /api/members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}
