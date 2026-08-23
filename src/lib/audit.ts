import { query } from './db';

/**
 * Audit trail helper — appends a row to `audit_logs`.
 *
 * Call AFTER a mutating handler's DB write has succeeded (never before),
 * so the trail only records effects that actually happened.
 *
 * Resilient by design: an audit failure is logged but never thrown, so a
 * logging problem can't turn an already-committed business operation into
 * a 500 for the user.
 *
 * @param actorId  Session user performing the action (null for system events).
 * @param action   Uppercase verb, e.g. 'MEMBER_UPDATE', 'LOAN_APPROVE'.
 * @param entity   Entity kind, e.g. 'user' | 'loan' | 'savings'.
 * @param entityId Entity PK (uuid) or null when not tied to one row.
 * @param meta     Free-form JSON payload (before/after values, reason, ...).
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
