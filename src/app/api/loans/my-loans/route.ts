import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await query(
      `SELECT * FROM loans WHERE user_id = $1 ORDER BY created_at DESC`,
      [session.userId]
    );

    return NextResponse.json({ loans: result.rows });
  } catch (error) {
    console.error('Error fetching my loans:', error);
    return NextResponse.json({ error: 'Failed to fetch loans' }, { status: 500 });
  }
}
