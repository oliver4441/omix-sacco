'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';

interface NotificationItem {
  id: string;
  channel?: 'IN_APP' | 'SMS';
  eventType?: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Notification center bell — polls GET /api/notifications every 60 s,
 * shows an unread badge and a dropdown of the latest items.
 * Opening the dropdown marks visible unread items read
 * (PATCH /api/notifications/read); "Mark all read" clears the rest.
 *
 * Self-contained client component — drop <NotificationBell /> into any
 * header/nav (e.g. src/app/dashboard/layout.tsx).
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data: { notifications?: NotificationItem[]; unreadCount?: number } = await res.json();
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
    } catch {
      // Polling failure is non-fatal; next tick retries.
    }
  }, []);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(), 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  const markRead = async (ids: string[]) => {
    try {
      await fetch('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // server state reconciles on next poll
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const unreadIds = items.filter((n) => !n.readAt).map((n) => n.id);
      if (unreadIds.length > 0) {
        // Optimistic update; API call reconciles.
        setItems((prev) =>
          prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))
        );
        setUnread(0);
        void markRead(unreadIds);
      }
    }
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await fetch('/api/notifications/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // ignore; poll will reconcile
    }
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative p-2 text-slate-400 hover:text-white transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away overlay */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 sm:w-96 glass-card overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <p className="text-sm font-semibold text-white">Notifications</p>
              <button
                onClick={() => void markAllRead()}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-orange-400 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-8">No notifications yet</p>
              ) : (
                items.slice(0, 10).map((n) => (
                  <div key={n.id} className="px-4 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/5">
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-orange-500" />}
                      <div className={n.readAt ? 'pl-4' : ''}>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white">{n.title}</p>
                          {n.channel === 'SMS' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400">SMS</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.body}</p>
                        <p className="text-[11px] text-slate-600 mt-1">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
