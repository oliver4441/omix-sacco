import { query } from './db';

/** Channels supported by the notifications table CHECK constraint. */
export type NotificationChannel = 'IN_APP' | 'SMS';

/**
 * In-app notification helper — inserts a row into `notifications`
 * (visible immediately in the notification center / bell UI).
 *
 * Phase 2 SMS pipeline reuses this table: pass channel='SMS' to enqueue a
 * row for the dispatch cron; default stays 'IN_APP'.
 *
 * Resilient by design: notification failure is logged but never thrown so a
 * side-effect after a committed mutation can't fail the caller's request.
 *
 * @param userId    Recipient user id.
 * @param eventType Machine event name, e.g. 'LOAN_APPROVED', 'GUARANTOR_REQUEST',
 *                  'ACCOUNT_SUSPENDED'. UPPERCASE, ≤ 50 chars (VARCHAR(50)).
 * @param title     Short human headline (≤ 200 chars).
 * @param body      Human-readable message body.
 * @param meta      Structured extras (ids, amounts) for deep-linking in the UI.
 */
export async function notify(
  userId: string,
  eventType: string,
  title: string,
  body: string,
  meta: Record<string, unknown> = {},
  channel: NotificationChannel = 'IN_APP'
): Promise<void> {
  try {
    await query(
      `INSERT INTO notifications (user_id, channel, event_type, title, body, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, channel, eventType, title.slice(0, 200), body, JSON.stringify(meta)]
    );
  } catch (error) {
    console.error('notify:', error);
  }
}
