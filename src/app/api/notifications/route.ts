import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

interface NotificationRow {
  id: string;
  channel: 'IN_APP' | 'SMS';
  event_type: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
}

function mapNotification(n: NotificationRow) {
  return {
    id: n.id,
    channel: n.channel,
    eventType: n.event_type,
    title: n.title,
    body: n.body,
    meta: n.meta ?? {},
    readAt: n.read_at instanceof Date ? n.read_at.toISOString() : n.read_at,
    createdAt: n.created_at instanceof Date ? n.created_at.toISOString() : n.created_at,
  };
}

/**
 * GET /api/notifications   (any authenticated user — MEMBER+)
 * Latest 50 notifications for the session user + unread count.
 * The bell UI polls this every 60 s.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [listResult, unreadResult] = await Promise.all([
      query(
        `SELECT id, channel, event_type, title, body, meta, read_at, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [session.userId]
      ),
      query(
        `SELECT COUNT(*)::int AS unread FROM notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [session.userId]
      ),
    ]);

    return NextResponse.json({
      notifications: (listResult.rows as NotificationRow[]).map(mapNotification),
      unreadCount: unreadResult.rows[0]?.unread ?? 0,
    });
  } catch (error) {
    console.error('GET /api/notifications:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}
