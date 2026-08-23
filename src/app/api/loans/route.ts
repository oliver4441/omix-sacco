import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Listing ALL loans (with member names/emails) is staff/admin only.
  // Members must use /api/loans/my-loans.
  if (session.role !== 'ADMIN' && session.role !== 'STAFF') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') || '20');

  try {
    let sql = `
      SELECT l.*, u.full_name as user_name, u.email as user_email
      FROM loans l
      JOIN users u ON l.user_id = u.id
    `;
    const params: unknown[] = [];

    if (status) {
      sql += ` WHERE l.status = $1`;
      params.push(status);
    }

    sql += ` ORDER BY l.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);

    return NextResponse.json({ loans: result.rows });
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
    const { amount, durationMonths, purpose, interestRate } = await request.json();

    if (!amount || !durationMonths) {
      return NextResponse.json({ error: 'Amount and duration are required' }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO loans (user_id, amount, interest_rate, duration_months, purpose, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')
       RETURNING *`,
      [session.userId, amount, interestRate || 12.5, durationMonths, purpose || null]
    );

    return NextResponse.json({ loan: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('Error creating loan:', error);
    return NextResponse.json({ error: 'Failed to create loan' }, { status: 500 });
  }
}
