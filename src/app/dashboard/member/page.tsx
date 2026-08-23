'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Landmark, DollarSign, FileText, Loader2, Plus } from 'lucide-react';

interface MemberStats { totalSavings: number; activeLoan: number; pendingLoan: number; }
interface Loan { id: string; amount: number; interest_rate: number; duration_months: number; purpose: string | null; status: string; created_at: string; }

export default function MemberDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<MemberStats>({ totalSavings: 0, activeLoan: 0, pendingLoan: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [duration, setDuration] = useState('12');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([fetch('/api/dashboard/member-stats'), fetch('/api/loans/my-loans')]);
      if (sRes.ok) setStats(await sRes.json());
      if (lRes.ok) setLoans((await lRes.json()).loans || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSubmitting(true);
    try {
      const res = await fetch('/api/loans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: parseFloat(amount), durationMonths: parseInt(duration), purpose, interestRate: 12.5 }) });
      if (res.ok) { setShowForm(false); setAmount(''); setPurpose(''); fetchData(); }
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Member Dashboard</h1><p className="text-slate-400 text-sm mt-1">Manage your savings and loans</p></div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-lg font-medium text-sm"><Plus className="w-4 h-4" /> Apply for Loan</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Savings', value: `KES ${stats.totalSavings.toLocaleString()}`, icon: Landmark, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Active Loan', value: stats.activeLoan > 0 ? `KES ${stats.activeLoan.toLocaleString()}` : 'None', icon: DollarSign, color: 'text-orange-400', bg: 'bg-orange-500/10' },
          { label: 'Pending', value: stats.pendingLoan.toString(), icon: FileText, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card p-5">
            <div className={`p-2.5 rounded-xl ${s.bg} mb-3`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
            <p className="text-slate-400 text-xs uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Apply for a Loan</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-sm text-slate-300 mb-1">Amount (KES)</label><input type="number" required min="1000" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="e.g. 50000" /></div>
              <div><label className="block text-sm text-slate-300 mb-1">Duration</label><select value={duration} onChange={e => setDuration(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"><option value="6">6 Months</option><option value="12">12 Months</option><option value="24">24 Months</option><option value="36">36 Months</option></select></div>
              <div><label className="block text-sm text-slate-300 mb-1">Purpose</label><textarea required value={purpose} onChange={e => setPurpose(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 h-20 resize-none" placeholder="Describe the purpose" /></div>
              {amount && <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg"><p className="text-xs text-slate-300">Est. Monthly: <span className="text-white font-bold">KES {(parseFloat(amount) * 1.125 / parseInt(duration)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></p></div>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-lg border border-white/10 text-slate-300 text-sm">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm">{submitting ? 'Submitting...' : 'Submit'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">My Loans</h3>
        {loans.length === 0 ? <p className="text-slate-400 text-sm py-8 text-center">No loans yet</p> : (
          <div className="space-y-3">
            {loans.map(l => (
              <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white/5 rounded-xl">
                <div><p className="text-white font-medium">KES {Number(l.amount).toLocaleString()}</p><p className="text-slate-400 text-xs mt-1">{l.duration_months} months at {l.interest_rate}%</p>{l.purpose && <p className="text-slate-500 text-xs mt-1">{l.purpose}</p>}</div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium w-fit ${l.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400' : l.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400' : l.status === 'REJECTED' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>{l.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
