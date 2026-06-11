import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session || (session.role !== 'STAFF' && session.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [membersResult, pendingResult, savingsResult] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM users WHERE role = 'MEMBER'`),
      query(`SELECT COUNT(*) as count FROM loans WHERE status = 'PENDING'`),
      query(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
          COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) as withdrawals
        FROM savings WHERE status = 'COMPLETED'
      `),
    ]);

    return NextResponse.json({
      totalMembers: parseInt(membersResult.rows[0].count),
      pendingLoans: parseInt(pendingResult.rows[0].count),
      totalSavings: Number(savingsResult.rows[0].deposits) - Number(savingsResult.rows[0].withdrawals),
    });
  } catch (error) {
    console.error('Error fetching staff stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
