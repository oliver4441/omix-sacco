import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Total savings (deposits - withdrawals)
    const savingsResult = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END), 0) as total_deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAWAL' THEN amount ELSE 0 END), 0) as total_withdrawals
      FROM savings WHERE status = 'COMPLETED'
    `);
    const totalSavings = Number(savingsResult.rows[0].total_deposits) - Number(savingsResult.rows[0].total_withdrawals);

    // Active loans (disbursed)
    const loansResult = await query(`
      SELECT COALESCE(SUM(amount), 0) as active_loans
      FROM loans WHERE status = 'DISBURSED'
    `);
    const activeLoans = Number(loansResult.rows[0].active_loans);

    // Total members
    const membersResult = await query(`
      SELECT COUNT(*) as count FROM users WHERE role = 'MEMBER'
    `);
    const totalMembers = parseInt(membersResult.rows[0].count);

    // Pending approvals
    const pendingResult = await query(`
      SELECT COUNT(*) as count FROM loans WHERE status = 'PENDING'
    `);
    const pendingApprovals = parseInt(pendingResult.rows[0].count);

    // Monthly savings data for chart
    const monthlyResult = await query(`
      SELECT 
        TO_CHAR(created_at, 'Mon') as month,
        SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END) as value
      FROM savings 
      WHERE status = 'COMPLETED' AND created_at > NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(created_at, 'Mon'), EXTRACT(MONTH FROM created_at)
      ORDER BY EXTRACT(MONTH FROM created_at)
    `);

    return NextResponse.json({
      totalSavings,
      activeLoans,
      totalMembers,
      pendingApprovals,
      monthlyData: monthlyResult.rows.map(r => ({ name: r.month, value: Number(r.value) })),
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
