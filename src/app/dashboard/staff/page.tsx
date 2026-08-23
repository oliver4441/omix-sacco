'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, DollarSign, FileText, Loader2, Check, X } from 'lucide-react';

interface StaffStats { totalMembers: number; pendingLoans: number; totalSavings: number; }
interface Loan { id: string; amount: number; interest_rate: number; duration_months: number; purpose: string | null; status: string; created_at: string; user_name: string; user_email: string; }

export default function StaffDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StaffStats>({ totalMembers: 0, pendingLoans: 0, totalSavings: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([fetch('/api/dashboard/staff-stats'), fetch('/api/loans?status=PENDING&limit=20')]);
      if (sRes.ok) setStats(await sRes.json());
      if (lRes.ok) setLoans((await lRes.json()).loans || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleLoan = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    await fetch(`/api/loans/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action }) });
    fetchData();
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  return (
    <div className="space-y-8">
      <div><h1 className="text-2xl font-bold text-white">Staff Dashboard</h1><p className="text-slate-400 text-sm mt-1">Review and process loan applications</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Members', value: stats.totalMembers.toString(), icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Pending Loans', value: stats.pendingLoans.toString(), icon: FileText, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
          { label: 'Total Savings', value: `KES ${stats.totalSavings.toLocaleString()}`, icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card p-5">
            <div className={`p-2.5 rounded-xl ${s.bg} mb-3`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
            <p className="text-slate-400 text-xs uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Pending Loan Applications</h3>
        {loans.length === 0 ? <p className="text-slate-400 text-sm py-8 text-center">No pending applications</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 border-b border-white/5"><th className="text-left py-3 px-2">Member</th><th className="text-left py-3 px-2">Amount</th><th className="text-left py-3 px-2">Duration</th><th className="text-left py-3 px-2">Purpose</th><th className="text-left py-3 px-2">Actions</th></tr></thead>
              <tbody>
                {loans.map(l => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-2"><p className="text-white font-medium">{l.user_name || 'Unknown'}</p><p className="text-slate-500 text-xs">{l.user_email}</p></td>
                    <td className="py-3 px-2 text-white">KES {Number(l.amount).toLocaleString()}</td>
                    <td className="py-3 px-2 text-slate-300">{l.duration_months} months</td>
                    <td className="py-3 px-2 text-slate-300 max-w-[200px] truncate">{l.purpose || '-'}</td>
                    <td className="py-3 px-2"><div className="flex gap-2"><button onClick={() => handleLoan(l.id, 'APPROVED')} className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg"><Check className="w-4 h-4 text-emerald-400" /></button><button onClick={() => handleLoan(l.id, 'REJECTED')} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg"><X className="w-4 h-4 text-red-400" /></button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
