'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, DollarSign, TrendingUp, Landmark, Loader2, RefreshCw, Check, X,
  Search, ChevronLeft, ChevronRight, Eye, Ban, RotateCcw,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import NotificationBell from '@/components/notification-bell';

// ---------- types ----------

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

type MemberStatus = 'ACTIVE' | 'SUSPENDED' | 'DORMANT';
type MemberRole = 'ADMIN' | 'STAFF' | 'MEMBER';

interface MemberRow {
  id: string;
  memberNo: string | null;
  fullName: string | null;
  email: string;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  joined: string;
  savingsBalance: number;
  activeLoanTotal: number;
}

interface RecentSaving {
  id: string;
  amount: number;
  transactionType: string;
  status: string;
  createdAt: string;
}

interface MemberDetail {
  member: MemberRow;
  savingsBalance: number;
  activeLoanTotal: number;
  loanSummary: { totalLoans: number; activeLoans: number; outstandingTotal: number };
  recentSavings: RecentSaving[];
}

// ---------- helpers ----------

const formatKES = (amount: number): string =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(amount);

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });

const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-500/10 text-emerald-400';
    case 'SUSPENDED': return 'bg-red-500/10 text-red-400';
    case 'DORMANT': return 'bg-yellow-500/10 text-yellow-400';
    default: return 'bg-slate-500/10 text-slate-400';
  }
};

const MEMBER_STATUSES: MemberStatus[] = ['ACTIVE', 'SUSPENDED', 'DORMANT'];
const PAGE_SIZE = 10;

export default function AdminDashboard() {
  // ----- overview state -----
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({ totalSavings: 0, activeLoans: 0, totalMembers: 0, pendingApprovals: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);
  const [chartData, setChartData] = useState<{ name: string; value: number }[]>([]);
  const [role, setRole] = useState<string>('');

  // ----- tabs -----
  const [tab, setTab] = useState<'overview' | 'members'>('overview');

  // ----- members state -----
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MemberStatus>('ALL');
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ----- member detail modal -----
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ---------- overview data ----------

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [sRes, lRes, meRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/loans?limit=10'),
        fetch('/api/auth/me'),
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
      if (meRes.ok) {
        const d = await meRes.json();
        setRole(d.user?.role ?? '');
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleLoan = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    await fetch(`/api/loans/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action }) });
    fetchData(true);
  };

  // ---------- members data ----------

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (q) params.set('q', q);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await fetch(`/api/members?${params.toString()}`);
      if (res.ok) {
        const d: { members?: MemberRow[]; total?: number } = await res.json();
        setMembers(d.members ?? []);
        setTotal(d.total ?? 0);
      }
    } catch (e) { console.error(e); }
    finally { setLoadingMembers(false); }
  }, [page, q, statusFilter]);

  useEffect(() => { if (tab === 'members') void fetchMembers(); }, [tab, fetchMembers]);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  // Reset to first page whenever filters change.
  useEffect(() => { setPage(1); }, [q, statusFilter]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await fetch(`/api/members/${id}`);
      if (res.ok) setDetail(await res.json());
    } catch (e) { console.error(e); }
    finally { setDetailLoading(false); }
  };

  const updateMember = async (
    m: MemberRow,
    payload: { status?: MemberStatus; role?: MemberRole },
    confirmMsg: string
  ) => {
    if (!window.confirm(confirmMsg)) {
      // Force controlled inputs back to current values on cancel.
      setMembers((prev) => [...prev]);
      return;
    }
    setBusyId(m.id);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/members/${m.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionMsg({ ok: false, text: data.error ?? 'Update failed' });
      } else {
        setActionMsg({ ok: true, text: `${m.fullName ?? m.email} updated.` });
        await fetchMembers();
        if (detail?.member.id === m.id) void openDetail(m.id);
      }
    } catch {
      setActionMsg({ ok: false, text: 'Network error — please retry.' });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="flex h-96 items-center justify-center"><Loader2 className="w-8 h-8 text-orange-500 animate-spin" /></div>;

  const isAdmin = role === 'ADMIN';
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <button onClick={() => fetchData(true)} className={`p-2 rounded-lg bg-white/5 hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}><RefreshCw className="w-4 h-4 text-slate-400" /></button>
          </div>
          <p className="text-slate-400 text-sm mt-1">Overview of your SACCO performance</p>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2"><div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" /> System Online</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['overview', 'members'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30' : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
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
                        <td className="py-3 px-2 text-white">{formatKES(Number(l.amount))}</td>
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
        </>
      )}

      {tab === 'members' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search name, email or member no…"
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-500"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'ALL' | MemberStatus)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            >
              <option value="ALL">All statuses</option>
              {MEMBER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {actionMsg && (
            <div className={`px-4 py-2.5 rounded-lg text-sm ${actionMsg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {actionMsg.text}
            </div>
          )}

          {/* Members table */}
          <div className="glass-card p-6">
            {loadingMembers ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
            ) : members.length === 0 ? (
              <p className="text-slate-400 text-sm py-8 text-center">No members found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/5">
                      <th className="text-left py-3 px-2">Member</th>
                      <th className="text-left py-3 px-2">Contact</th>
                      <th className="text-left py-3 px-2">Savings</th>
                      <th className="text-left py-3 px-2">Active Loans</th>
                      <th className="text-left py-3 px-2">Status</th>
                      <th className="text-left py-3 px-2">Joined</th>
                      <th className="text-left py-3 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-3 px-2">
                          <p className="text-white font-medium">{m.fullName ?? 'Unnamed'}</p>
                          <p className="text-slate-500 text-xs">{m.memberNo ?? '—'} · {m.role}</p>
                        </td>
                        <td className="py-3 px-2">
                          <p className="text-slate-300 text-xs">{m.email}</p>
                          <p className="text-slate-500 text-xs">{m.phone ?? '—'}</p>
                        </td>
                        <td className="py-3 px-2 text-emerald-400 font-medium">{formatKES(m.savingsBalance)}</td>
                        <td className="py-3 px-2 text-orange-400 font-medium">{formatKES(m.activeLoanTotal)}</td>
                        <td className="py-3 px-2"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadgeClass(m.status)}`}>{m.status}</span></td>
                        <td className="py-3 px-2 text-slate-300 text-xs">{formatDate(m.joined)}</td>
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2">
                            <button onClick={() => openDetail(m.id)} title="View profile" className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg">
                              <Eye className="w-4 h-4 text-slate-300" />
                            </button>
                            {isAdmin && (
                              <>
                                <select
                                  key={`${m.id}-${m.role}`}
                                  value={m.role}
                                  disabled={busyId === m.id}
                                  onChange={(e) => {
                                    const next = e.target.value as MemberRole;
                                    if (next !== m.role) {
                                      void updateMember(m, { role: next }, `Change ${m.fullName ?? m.email}'s role from ${m.role} to ${next}?`);
                                    }
                                  }}
                                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-orange-500 disabled:opacity-50"
                                >
                                  {(['MEMBER', 'STAFF', 'ADMIN'] as MemberRole[]).map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                {m.status === 'ACTIVE' ? (
                                  <button
                                    disabled={busyId === m.id}
                                    onClick={() => updateMember(m, { status: 'SUSPENDED' }, `Suspend ${m.fullName ?? m.email}'s account? They will be unable to log in.`)}
                                    title="Suspend"
                                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 rounded-lg disabled:opacity-50"
                                  >
                                    <Ban className="w-4 h-4 text-red-400" />
                                  </button>
                                ) : (
                                  <button
                                    disabled={busyId === m.id}
                                    onClick={() => updateMember(m, { status: 'ACTIVE' }, `Set ${m.fullName ?? m.email}'s account to ACTIVE?`)}
                                    title="Activate"
                                    className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg disabled:opacity-50"
                                  >
                                    <RotateCcw className="w-4 h-4 text-emerald-400" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                  <p className="text-xs text-slate-500">Showing {rangeStart}–{rangeEnd} of {total}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5">
                      <ChevronLeft className="w-4 h-4 text-slate-300" />
                    </button>
                    <span className="text-xs text-slate-400">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5">
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </button>
                  </div>
                </div>
              </div>
            )
            }
          </div >
          {!isAdmin && (
            <p className="text-xs text-slate-500">Read-only view — role and status management requires ADMIN.</p>
          )}
        </div >
      )}

      {/* Member detail modal */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => { setDetail(null); }}>
          <div className="glass-card w-full max-w-lg p-6 space-y-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {detailLoading || !detail ? (
              <div className="flex h-32 items-center justify-center"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">{detail.member.fullName ?? 'Unnamed member'}</h3>
                    <p className="text-slate-500 text-xs mt-0.5">{detail.member.memberNo ?? 'No member no'} · Joined {formatDate(detail.member.joined)}</p>
                  </div>
                  <button onClick={() => setDetail(null)} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10"><X className="w-4 h-4 text-slate-400" /></button>
                </div>

                <div className="flex gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusBadgeClass(detail.member.status)}`}>{detail.member.status}</span>
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-500/10 text-orange-400">{detail.member.role}</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-slate-500 text-xs uppercase tracking-wider">Email</p><p className="text-slate-200 break-all">{detail.member.email}</p></div>
                  <div><p className="text-slate-500 text-xs uppercase tracking-wider">Phone</p><p className="text-slate-200">{detail.member.phone ?? '—'}</p></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
                    <p className="text-emerald-400 text-xs uppercase tracking-wider">Savings Balance</p>
                    <p className="text-white font-bold mt-1">{formatKES(detail.savingsBalance)}</p>
                  </div>
                  <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 p-3">
                    <p className="text-orange-400 text-xs uppercase tracking-wider">Active Loans</p>
                    <p className="text-white font-bold mt-1">{formatKES(detail.activeLoanTotal)}</p>
                  </div>
                </div>

                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Loan History</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 text-slate-300">{detail.loanSummary.totalLoans} total</span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 text-slate-300">{detail.loanSummary.activeLoans} active</span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/5 text-slate-300">{formatKES(detail.loanSummary.outstandingTotal)} outstanding</span>
                  </div>
                </div>

                <div>
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Recent Savings</p>
                  {detail.recentSavings.length === 0 ? (
                    <p className="text-slate-500 text-sm">No savings activity yet</p>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {detail.recentSavings.map((s) => (
                        <div key={s.id} className="flex items-center justify-between py-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.transactionType === 'DEPOSIT' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>{s.transactionType}</span>
                            <span className="text-xs text-slate-500">{formatDate(s.createdAt)} · {s.status}</span>
                          </div>
                          <span className={`text-sm font-medium ${s.transactionType === 'DEPOSIT' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {s.transactionType === 'DEPOSIT' ? '+' : '−'}{formatKES(s.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
