import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userId = session.userId;

    // Total savings
    const savingsResult = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) as withdrawals
      FROM savings WHERE user_id = $1 AND status = 'COMPLETED'
    `, [userId]);
    const totalSavings = Number(savingsResult.rows[0].deposits) - Number(savingsResult.rows[0].withdrawals);

    // Active loan
    const loanResult = await query(`
      SELECT COALESCE(SUM(amount), 0) as active_loan
      FROM loans WHERE user_id = $1 AND status = 'DISBURSED'
    `, [userId]);
    const activeLoan = Number(loanResult.rows[0].active_loan);

    // Pending loans count
    const pendingResult = await query(`
      SELECT COUNT(*) as count FROM loans WHERE user_id = $1 AND status = 'PENDING'
    `, [userId]);
    const pendingLoan = parseInt(pendingResult.rows[0].count);

    return NextResponse.json({ totalSavings, activeLoan, pendingLoan });
  } catch (error) {
    console.error('Error fetching member stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
