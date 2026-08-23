'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, DollarSign, TrendingUp, Landmark, Loader2, RefreshCw, Check, X } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DashboardStats {
  totalSavings: number;
  activeLoans: number;
  totalMembers: number;
  pendingApprovals: number;
  monthlyData?: { name: string; value: number }[];
}

interface Loan {
  id: string;
  amount: number;
  interest_rate: number;
  duration_months: number;
  purpose: string | null;
  status: string;
  created_at: string;
  user_name: string;
  user_email: string;
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({ totalSavings: 0, activeLoans: 0, totalMembers: 0, pendingApprovals: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);
  const [chartData, setChartData] = useState<{ name: string; value: number }[]>([]);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/loans?limit=10'),
      ]);
      if (sRes.ok) {
        const d = await sRes.json();
        setStats(d);
        if (d.monthlyData) setChartData(d.monthlyData);
      }
      if (lRes.ok) {
        const d = await lRes.json();
        setLoans(d.loans || []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleLoan = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    await fetch(`/api/loans/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action }) });
    fetchData(true);
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <button onClick={() => fetchData(true)} className={`p-2 rounded-lg bg-white/5 hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}><RefreshCw className="w-4 h-4 text-slate-400" /></button>
          </div>
          <p className="text-slate-400 text-sm mt-1">Overview of your SACCO performance</p>
        </div>
        <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2"><div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" /> System Online</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Savings', value: `KES ${stats.totalSavings.toLocaleString()}`, icon: Landmark, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Active Loans', value: `KES ${stats.activeLoans.toLocaleString()}`, icon: DollarSign, color: 'text-orange-400', bg: 'bg-orange-500/10' },
          { label: 'Total Members', value: stats.totalMembers.toString(), icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Pending', value: stats.pendingApprovals.toString(), icon: TrendingUp, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card p-5">
            <div className={`p-2.5 rounded-xl ${s.bg} mb-3`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
            <p className="text-slate-400 text-xs uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Savings Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs><linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.3} /><stop offset="95%" stopColor="#f97316" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="name" stroke="#64748b" fontSize={12} /><YAxis stroke="#64748b" fontSize={12} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }} />
              <Area type="monotone" dataKey="value" stroke="#f97316" fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Loan Applications</h3>
        {loans.length === 0 ? <p className="text-slate-400 text-sm py-8 text-center">No loan applications yet</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 border-b border-white/5"><th className="text-left py-3 px-2">Member</th><th className="text-left py-3 px-2">Amount</th><th className="text-left py-3 px-2">Duration</th><th className="text-left py-3 px-2">Purpose</th><th className="text-left py-3 px-2">Status</th><th className="text-left py-3 px-2">Actions</th></tr></thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-2"><p className="text-white font-medium">{l.user_name || 'Unknown'}</p><p className="text-slate-500 text-xs">{l.user_email}</p></td>
                    <td className="py-3 px-2 text-white">KES {Number(l.amount).toLocaleString()}</td>
                    <td className="py-3 px-2 text-slate-300">{l.duration_months} months</td>
                    <td className="py-3 px-2 text-slate-300 max-w-[200px] truncate">{l.purpose || '-'}</td>
                    <td className="py-3 px-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${l.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400' : l.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400' : l.status === 'REJECTED' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>{l.status}</span></td>
                    <td className="py-3 px-2">{l.status === 'PENDING' && <div className="flex gap-2"><button onClick={() => handleLoan(l.id, 'APPROVED')} className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg"><Check className="w-4 h-4 text-emerald-400" /></button><button onClick={() => handleLoan(l.id, 'REJECTED')} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg"><X className="w-4 h-4 text-red-400" /></button></div>}</td>
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
