'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, LogOut, Menu, X } from 'lucide-react';

interface UserSession {
  userId: string;
  email: string;
  role: string;
  fullName: string | null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserSession | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { router.push('/login'); return; }
        const data = await res.json();
        setUser(data.user);
      } catch { router.push('/login'); }
      finally { setLoading(false); }
    };
    checkAuth();
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const role = user.role.toLowerCase();
  const navItems = [
    { label: 'Dashboard', href: `/dashboard/${role}` },
    ...(user.role === 'ADMIN' || user.role === 'STAFF'
      ? [{ label: 'Members', href: '/dashboard/members' }, { label: 'Loans', href: '/dashboard/loans' }, { label: 'Savings', href: '/dashboard/savings' }]
      : []),
    ...(user.role === 'ADMIN' ? [{ label: 'Settings', href: '/dashboard/settings' }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0a0f1a]">
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0a0f1a]/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between h-16 px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 text-slate-400 hover:text-white">
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                <Landmark className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-white hidden sm:block">Omix SACCO</span>
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-400 hidden sm:block">
              {user.fullName} <span className="text-slate-600">|</span> <span className="text-orange-400">{user.role}</span>
            </span>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-white transition-colors"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>
      <div className="flex pt-16">
        <aside className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-[#0a0f1a] border-r border-white/5 transform transition-transform lg:transform-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} pt-16 lg:pt-0`}>
          <nav className="p-4 space-y-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 lg:ml-0 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
