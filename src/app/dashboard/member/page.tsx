'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Landmark, DollarSign, FileText, Loader2, Plus, ArrowDownToLine, ArrowUpFromLine, Wallet } from 'lucide-react';
import { formatKES } from '@/lib/format';

interface MemberStats { totalSavings: number; activeLoan: number; pendingLoan: number; }
interface Loan { id: string; amount: number; interest_rate: number; duration_months: number; purpose: string | null; status: string; created_at: string; }
interface SavingsEntry { id: string; amount: number; transaction_type: 'DEPOSIT' | 'WITHDRAWAL'; status: 'PENDING' | 'COMPLETED' | 'FAILED'; created_at: string; rejection_reason?: string | null; }
interface SavingsData { entries: SavingsEntry[]; balance: number; pendingWithdrawals: number; }

const statusBadge = (status: string) =>
  status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400'
  : status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400'
  : 'bg-red-500/10 text-red-400';

export default function MemberDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<MemberStats>({ totalSavings: 0, activeLoan: 0, pendingLoan: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);
  const [savings, setSavings] = useState<SavingsData | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [duration, setDuration] = useState('12');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [depositError, setDepositError] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sRes, lRes, savRes] = await Promise.all([
        fetch('/api/dashboard/member-stats'),
        fetch('/api/loans/my-loans'),
        fetch('/api/savings'),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (lRes.ok) setLoans((await lRes.json()).loans || []);
      if (savRes.ok) setSavings(await savRes.json());
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

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDepositError(''); setDepositing(true);
    try {
      const res = await fetch('/api/savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'DEPOSIT', amount: parseFloat(depositAmount) }),
      });
      if (res.ok) {
        setShowDeposit(false); setDepositAmount('');
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        setDepositError(data.error || 'Deposit failed — please try again.');
      }
    } catch (e) { console.error(e); setDepositError('Deposit failed — please try again.'); }
    finally { setDepositing(false); }
  };

  const handleWithdraw = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;
    setDepositError(''); setDepositing(true);
    try {
      const res = await fetch('/api/savings/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(depositAmount) }),
      });
      if (res.ok) {
        setShowDeposit(false); setDepositAmount('');
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        setDepositError(data.error || 'Withdrawal request failed.');
      }
    } catch (e) { console.error(e); setDepositError('Withdrawal request failed.'); }
    finally { setDepositing(false); }
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Member Dashboard</h1><p className="text-slate-400 text-sm mt-1">Manage your savings and loans</p></div>
        <div className="flex gap-3">
          <button onClick={() => { setDepositError(''); setShowDeposit(true); }} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2.5 rounded-lg font-medium text-sm"><ArrowDownToLine className="w-4 h-4" /> Deposit / Withdraw</button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-lg font-medium text-sm"><Plus className="w-4 h-4" /> Apply for Loan</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Savings Balance', value: formatKES(savings?.balance ?? stats.totalSavings), icon: Landmark, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Pending Withdrawals', value: formatKES(savings?.pendingWithdrawals ?? 0), icon: ArrowUpFromLine, color: 'text-purple-400', bg: 'bg-purple-500/10' },
          { label: 'Active Loan', value: stats.activeLoan > 0 ? formatKES(stats.activeLoan) : 'None', icon: DollarSign, color: 'text-orange-400', bg: 'bg-orange-500/10' },
          { label: 'Pending Loans', value: stats.pendingLoan.toString(), icon: FileText, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card p-5">
            <div className={`p-2.5 rounded-xl ${s.bg} mb-3`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
            <p className="text-slate-400 text-xs uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {showDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Savings Transaction</h3>
            <form onSubmit={handleDeposit} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Amount (KES)</label>
                <input type="number" required min="1" step="0.01" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g. 5000" />
              </div>
              {depositError && <p className="text-xs text-red-400">{depositError}</p>}
              <p className="text-xs text-slate-400">Available for withdrawal: <span className="text-white font-medium">{formatKES((savings?.balance ?? 0) - (savings?.pendingWithdrawals ?? 0))}</span>. Deposits and withdrawals are confirmed by staff.</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowDeposit(false)} className="flex-1 py-2.5 rounded-lg border border-white/10 text-slate-300 text-sm">Cancel</button>
                <button type="button" onClick={handleWithdraw} disabled={depositing} className="flex items-center justify-center gap-1.5 flex-1 py-2.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm disabled:opacity-50"><ArrowUpFromLine className="w-3.5 h-3.5" /> {depositing ? 'Sending...' : 'Withdraw'}</button>
                <button type="submit" disabled={depositing} className="flex items-center justify-center gap-1.5 flex-1 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-sm disabled:opacity-50"><ArrowDownToLine className="w-3.5 h-3.5" /> {depositing ? 'Saving...' : 'Deposit'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Savings Transactions</h3>
          <span className="flex items-center gap-1.5 text-sm text-slate-400"><Wallet className="w-4 h-4 text-emerald-400" /> {formatKES(savings?.balance ?? 0)}</span>
        </div>
        {!savings || savings.entries.length === 0 ? <p className="text-slate-400 text-sm py-8 text-center">No savings transactions yet</p> : (
          <div className="space-y-3">
            {savings.entries.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-4 bg-white/5 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${t.transaction_type === 'DEPOSIT' ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                    {t.transaction_type === 'DEPOSIT'
                      ? <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
                      : <ArrowUpFromLine className="w-4 h-4 text-red-400" />}
                  </div>
                  <div>
                    <p className={`font-medium ${t.transaction_type === 'DEPOSIT' ? 'text-emerald-400' : 'text-red-400'}`}>{t.transaction_type === 'DEPOSIT' ? '+' : '-'}{formatKES(t.amount)}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{new Date(t.created_at).toLocaleString()}{t.rejection_reason ? ` · ${t.rejection_reason}` : ''}</p>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium w-fit ${statusBadge(t.status)}`}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-card w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-white mb-4">Apply for a Loan</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div><label className="block text-sm text-slate-300 mb-1">Amount (KES)</label><input type="number" required min="1000" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="e.g. 50000" /></div>
              <div><label className="block text-sm text-slate-300 mb-1">Duration</label><select value={duration} onChange={e => setDuration(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"><option value="3">3 Months</option><option value="6">6 Months</option><option value="9">9 Months</option><option value="12">12 Months</option><option value="18">18 Months</option><option value="24">24 Months</option></select></div>
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
                <div><p className="text-white font-medium">{formatKES(l.amount)}</p><p className="text-slate-400 text-xs mt-1">{l.duration_months} months at {l.interest_rate}%</p>{l.purpose && <p className="text-slate-500 text-xs mt-1">{l.purpose}</p>}</div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium w-fit ${l.status === 'PENDING' ? 'bg-yellow-500/10 text-yellow-400' : l.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400' : l.status === 'REJECTED' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>{l.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
