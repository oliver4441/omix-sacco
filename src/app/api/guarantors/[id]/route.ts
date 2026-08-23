import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * PATCH /api/guarantors/[id] — guarantor accept/decline.
 * Spec: guarantorDecisionSchema { action: 'APPROVED' | 'REJECTED' }.
 * Only the addressed guarantor themself (or ADMIN), and only while the
 * underlying loan is still PENDING. Stamps responded_at.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const action = body?.action;

    if (action !== 'APPROVED' && action !== 'REJECTED') {
      return NextResponse.json(
        { error: "Invalid action — must be 'APPROVED' or 'REJECTED'" },
        { status: 400 }
      );
    }

    // Load the request together with its loan state for authz + guard checks.
    const existing = await query(
      `SELECT g.id, g.guarantor_id, g.status AS current_status,
              l.status AS loan_status, l.user_id AS borrower_id
         FROM guarantors g
         JOIN loans l ON l.id = g.loan_id
        WHERE g.id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Guarantee request not found' }, { status: 404 });
    }

    const row = existing.rows[0];
    const isAddressee = row.guarantor_id === session.userId;
    const isAdmin = session.role === 'ADMIN';
    if (!isAddressee && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (row.loan_status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Guarantor decisions are only allowed while the loan is PENDING' },
        { status: 409 }
      );
    }

    const result = await query(
      `UPDATE guarantors
          SET status = $1, responded_at = NOW()
        WHERE id = $2
        RETURNING id, loan_id, guarantor_id, status, guaranteed_amount, responded_at`,
      [action, id]
    );

    return NextResponse.json({ request: result.rows[0] });
  } catch (error) {
    console.error('Error updating guarantee request:', error);
    return NextResponse.json({ error: 'Failed to update guarantee request' }, { status: 500 });
  }
}
