'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  DollarSign,
  FileText,
  Loader2,
  Check,
  X,
  CalendarDays,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { buildSchedule, computeLoanTerms, type ScheduleRow } from '@/lib/loan-schedule';

interface StaffStats {
  totalMembers: number;
  pendingLoans: number;
  totalSavings: number;
}

interface Loan {
  id: string;
  amount: number | string;
  interest_rate: number | string;
  duration_months: number;
  purpose: string | null;
  status: string;
  total_payable?: number | string | null;
  approved_at?: string | null;
  disbursed_at?: string | null;
  created_at: string;
  user_name: string;
  user_email: string;
}

const money = (v: number | string) => `KES ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Flat-interest schedule fallback when total_payable is not on the row. */
function scheduleFor(loan: Loan): ScheduleRow[] {
  const start =
    loan.disbursed_at || loan.approved_at || loan.created_at || new Date().toISOString();
  const isoDate = start.slice(0, 10);
  const months = Number(loan.duration_months) || 1;
  const totalPayable = Number(
    loan.total_payable ??
      (() => {
        try {
          return computeLoanTerms(Number(loan.amount), months, Number(loan.interest_rate) || undefined)
            .totalPayable;
        } catch {
          return Number(loan.amount);
        }
      })()
  );
  try {
    return buildSchedule(totalPayable, months, isoDate);
  } catch {
    return [];
  }
}

export default function StaffDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StaffStats>({ totalMembers: 0, pendingLoans: 0, totalSavings: 0 });
  const [pending, setPending] = useState<Loan[]>([]);
  const [reviewed, setReviewed] = useState<Loan[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openSchedules, setOpenSchedules] = useState<Record<string, boolean>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sRes, pRes, rRes] = await Promise.all([
        fetch('/api/dashboard/staff-stats'),
        fetch('/api/loans?status=PENDING&pageSize=20'),
        fetch('/api/loans?status=APPROVED&pageSize=20'),
      ]);
      let dRes: Response | null = null;
      try {
        dRes = await fetch('/api/loans?status=DISBURSED&pageSize=20');
      } catch {
        /* optional */
      }
      if (sRes.ok) setStats(await sRes.json());
      if (pRes.ok) setPending((await pRes.json()).loans || []);
      const appr = rRes.ok ? ((await rRes.json()).loans || []) : [];
      const disb = dRes && dRes.ok ? ((await dRes.json()).loans || []) : [];
      setReviewed([...appr, ...disb]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoan = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    setBusyId(id);
    try {
      await fetch(`/api/loans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action }),
      });
      await fetchData();
    } finally {
      setBusyId(null);
    }
  };

  if (loading)
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Staff Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Review and process loan applications</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Members', value: stats.totalMembers.toString(), icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Pending Loans', value: stats.pendingLoans.toString(), icon: FileText, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
          { label: 'Total Savings', value: money(stats.totalSavings), icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ].map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="glass-card p-5">
            <div className={`p-2.5 rounded-xl ${s.bg} mb-3`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <p className="text-slate-400 text-xs uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-white mt-1">{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Pending review queue ── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Pending Loan Applications</h3>
        {pending.length === 0 ? (
          <p className="text-slate-400 text-sm py-8 text-center">No pending applications</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-white/5">
                  <th className="text-left py-3 px-2">Member</th>
                  <th className="text-left py-3 px-2">Amount</th>
                  <th className="text-left py-3 px-2">Duration</th>
                  <th className="text-left py-3 px-2">Purpose</th>
                  <th className="text-left py-3 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((l) => (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-3 px-2">
                      <p className="text-white font-medium">{l.user_name || 'Unknown'}</p>
                      <p className="text-slate-500 text-xs">{l.user_email}</p>
                    </td>
                    <td className="py-3 px-2 text-white">{money(l.amount)}</td>
                    <td className="py-3 px-2 text-slate-300">{l.duration_months} months</td>
                    <td className="py-3 px-2 text-slate-300 max-w-[200px] truncate">{l.purpose || '-'}</td>
                    <td className="py-3 px-2">
                      <div className="flex gap-2">
                        <button
                          disabled={busyId === l.id}
                          onClick={() => handleLoan(l.id, 'APPROVED')}
                          title="Approve"
                          className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg disabled:opacity-40"
                        >
                          {busyId === l.id ? <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" /> : <Check className="w-4 h-4 text-emerald-400" />}
                        </button>
                        <button
                          disabled={busyId === l.id}
                          onClick={() => handleLoan(l.id, 'REJECTED')}
                          title="Reject"
                          className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg disabled:opacity-40"
                        >
                          <X className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Approved / disbursed loans + repayment schedules ── */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Approved &amp; Disbursed Loans</h3>
        {reviewed.length === 0 ? (
          <p className="text-slate-400 text-sm py-8 text-center">No approved loans yet</p>
        ) : (
          <div className="space-y-2">
            {reviewed.map((l) => {
              const open = !!openSchedules[l.id];
              const rows = scheduleFor(l);
              return (
                <div key={l.id} className="rounded-xl border border-white/5 overflow-hidden">
                  <button
                    onClick={() => setOpenSchedules((s) => ({ ...s, [l.id]: !open }))}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 text-left"
                  >
                    <div>
                      <p className="text-white font-medium text-sm">
                        {l.user_name || 'Unknown'}{' '}
                        <span className="text-slate-500 font-normal">· {money(l.amount)} · {l.duration_months} mo</span>
                      </p>
                      <p className="text-xs mt-0.5">
                        <span
                          className={
                            l.status === 'DISBURSED'
                              ? 'text-cyan-300'
                              : l.status === 'APPROVED'
                                ? 'text-emerald-300'
                                : 'text-slate-400'
                          }
                        >
                          {l.status}
                        </span>
                      </p>
                    </div>
                    <span className="flex items-center gap-2 text-slate-400 text-xs">
                      <CalendarDays className="w-4 h-4" /> Schedule
                      {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4">
                      {rows.length === 0 ? (
                        <p className="text-slate-500 text-xs py-2">Schedule unavailable.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-slate-400 border-b border-white/5">
                              <th className="text-left py-2">#</th>
                              <th className="text-left py-2">Due date</th>
                              <th className="text-right py-2">Expected</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.installmentNo} className="border-b border-white/5 last:border-0">
                                <td className="py-2 text-slate-400">{r.installmentNo}</td>
                                <td className="py-2 text-slate-300">{r.dueDate}</td>
                                <td className="py-2 text-right text-white">{money(r.expectedAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
