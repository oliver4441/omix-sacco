import { query } from '@/lib/db';

/**
 * Append an entry to the audit trail. Call inside every successful
 * mutating handler, AFTER the primary DB write has succeeded.
 *
 * Failures are logged but never thrown — an audit hiccup must not
 * roll back or fail the user-facing operation.
 */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, entity, entityId, JSON.stringify(meta)]
    );
  } catch (error) {
    console.error('audit:', error);
  }
}
