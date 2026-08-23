import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/guarantors — guarantee requests addressed to the current user
 * (any authenticated role), joined with loan + borrower info.
 * Spec: IMPLEMENTATION_SPEC_PHASE_1_2.md §API `GET /api/guarantors/pending`.
 */
export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query(
      `SELECT g.id,
              g.status,
              g.guaranteed_amount,
              g.responded_at,
              g.created_at,
              l.id   AS loan_id,
              l.amount,
              l.duration_months,
              l.purpose,
              l.status AS loan_status,
              u.id   AS borrower_id,
              u.full_name AS borrower_name,
              u.email     AS borrower_email
         FROM guarantors g
         JOIN loans l ON l.id = g.loan_id
         JOIN users u ON u.id = l.user_id
        WHERE g.guarantor_id = $1
        ORDER BY g.created_at DESC`,
      [session.userId]
    );

    return NextResponse.json({ requests: result.rows });
  } catch (error) {
    console.error('Error listing guarantee requests:', error);
    return NextResponse.json({ error: 'Failed to load guarantee requests' }, { status: 500 });
  }
}
