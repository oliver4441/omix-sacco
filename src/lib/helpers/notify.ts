import { query } from '@/lib/db';

/**
 * Create an in-app notification for a user.
 * Phase 2 will extend this to also enqueue SMS rows (channel='SMS').
 *
 * Failures are logged but never thrown — notification hiccups must not
 * fail the surrounding financial operation.
 */
export async function notify(
  userId: string,
  eventType: string,
  title: string,
  body: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications (user_id, event_type, title, body, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, eventType, title, body, JSON.stringify(meta)]
    );
  } catch (error) {
    console.error('notify:', error);
  }
}
