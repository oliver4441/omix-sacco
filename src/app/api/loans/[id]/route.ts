import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== 'ADMIN' && session.role !== 'STAFF')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { status } = await request.json();

    if (!['PENDING', 'APPROVED', 'DISBURSED', 'REPAID', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const result = await query(
      `UPDATE loans SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
    }

    return NextResponse.json({ loan: result.rows[0] });
  } catch (error) {
    console.error('Error updating loan:', error);
    return NextResponse.json({ error: 'Failed to update loan' }, { status: 500 });
  }
}
