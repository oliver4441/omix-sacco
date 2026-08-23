/**
 * Loan-domain server helpers: business constants, request validation schemas,
 * transaction wrapper, eligibility evaluation, guarantor resolution, and
 * best-effort notify/audit.
 *
 * NOTE ON SHARED FILES: `src/lib/validation.ts` and `src/lib/format.ts` are
 * owned by another workstream. To avoid cross-file coupling this module keeps
 * its own LOCAL copies of the loan-related schemas/constants. If/when shared
 * versions land, these can be swapped for the canonical imports in one place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIRED MIGRATION before these helpers work against the DB (see
 * src/lib/loan-schedule.ts header for full SQL): 002_phase1_core.sql adds
 * users.member_no/users.status, loans lifecycle columns, guarantors.guaranteed_
 * amount/responded_at, table loan_repayments, tables notifications & audit_logs
 * (notify()/audit() below degrade gracefully to console.error if absent).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { z } from 'zod';
import { pool } from '@/lib/db';
import { computeLoanTerms, type LoanTerms } from '@/lib/loan-schedule';

// ── Business constants (spec §2.2 — local single source for the loans module) ──
export const SACCO = {
  INTEREST_RATE_PCT: 12.5,
  DURATION_MONTHS: [3, 6, 9, 12, 18, 24],
  LOAN_LIMIT_MULTIPLE_OF_SAVINGS: 3,
  MIN_SAVINGS_TO_BORROW: 5000,
  MIN_GUARANTOR_COUNT: 2,
  MIN_GUARANTOR_COVERAGE_PCT: 100,
  MAX_ACTIVE_LOANS_PER_MEMBER: 1,
  /** Upper bound on guarantors attached to a single application. */
  MAX_GUARANTORS_PER_LOAN: 5,
} as const;

export const LOAN_STATUSES = ['PENDING', 'APPROVED', 'DISBURSED', 'REPAID', 'REJECTED'] as const;
export const LOAN_TYPES = ['NORMAL', 'EMERGENCY', 'DEVELOPMENT', 'EDUCATION'] as const;
/** States that block a member from borrowing again / still count as exposure. */
export const NON_TERMINAL_STATUSES = ['PENDING', 'APPROVED', 'DISBURSED'] as const;

// ── Validation schemas (zod; compatible with v3 API shipped in package.json) ──

/** Float-safe 2-dp money check (avoids zod multipleOf float false-negatives). */
const moneySchema = z.coerce
  .number()
  .positive('Amount must be greater than zero')
  .max(10_000_000, 'Amount exceeds the maximum of KES 10,000,000')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, {
    message: 'Amount supports at most 2 decimal places',
  });

export const createLoanSchema = z.object({
  amount: moneySchema,
  durationMonths: z.coerce.number().int().refine(
    (v) => (SACCO.DURATION_MONTHS as readonly number[]).includes(v),
    `Invalid duration — allowed: ${SACCO.DURATION_MONTHS.join(', ')} months`
  ),
  purpose: z.string().max(500).optional(),
  // Server always recomputes interestRate from constants; client value ignored.
  loanType: z.enum(LOAN_TYPES).default('NORMAL'),
  guarantors: z
    .array(z.object({ identifier: z.string().min(3), guaranteedAmount: moneySchema }))
    .max(SACCO.MAX_GUARANTORS_PER_LOAN)
    .optional(),
});

export const addGuarantorSchema = z.object({
  identifier: z.string().min(3, 'Provide email, phone or member number'),
  guaranteedAmount: moneySchema,
});

export const guarantorDecisionSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED']),
});

export const repaymentSchema = z.object({ amount: moneySchema });

export const loanActionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'DISBURSE']),
  reason: z.string().max(500).optional(),
});

/** 400 response with flattened zod issues (matches codebase error convention). */
export function zodFail(result: z.SafeParseReturnType<unknown, unknown>) {
  const flat = result.error.flatten().fieldErrors;
  return Response.json({ error: 'Validation failed', issues: flat }, { status: 400 });
}

/** Uniform JSON error helper. */
export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Throwable HTTP error mapped to a JSON response by route handlers. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ── DB plumbing ───────────────────────────────────────────────────────────────

/** Minimal executor interface so helpers run on the pool OR inside a tx client. */
export interface QueryExecutor {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Run `fn` inside an explicit SQL transaction with BEGIN/COMMIT/ROLLBACK.
 * Throws re-raise after rollback; callers map HttpError to responses.
 */
export async function withTransaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client as unknown as QueryExecutor);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Transaction rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** True when a pg driver error is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

// ── Money / balance queries ───────────────────────────────────────────────────

/** Confirmed savings balance: Σ(DEPOSIT) − Σ(WITHDRAWAL) over COMPLETED rows. */
export async function getSavingsBalance(exec: QueryExecutor, userId: string): Promise<number> {
  const res = await exec.query(
    `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE -amount END), 0) AS balance
     FROM savings WHERE user_id = $1 AND status = 'COMPLETED'`,
    [userId]
  );
  return Number(res.rows[0]?.balance ?? 0);
}

/**
 * Amount of a user's savings already pledged as APPROVED guarantees on
 * non-terminal loans (i.e. still at risk).
 */
export async function getGuaranteedOutstanding(exec: QueryExecutor, guarantorId: string): Promise<number> {
  const res = await exec.query(
    `SELECT COALESCE(SUM(g.guaranteed_amount), 0) AS pledged
     FROM guarantors g
     JOIN loans l ON l.id = g.loan_id
     WHERE g.guarantor_id = $1 AND g.status = 'APPROVED' AND l.status IN ('PENDING','APPROVED','DISBURSED')`,
    [guarantorId]
  );
  return Number(res.rows[0]?.pledged ?? 0);
}

/** Free capacity a guarantor can still pledge: savings − outstanding pledges. */
export async function getGuarantorFreeCapacity(exec: QueryExecutor, guarantorId: string): Promise<number> {
  const [balance, pledged] = await Promise.all([
    getSavingsBalance(exec, guarantorId),
    getGuaranteedOutstanding(exec, guarantorId),
  ]);
  return Math.max(0, balance - pledged);
}

// ── Guarantor identifier resolution ───────────────────────────────────────────

/**
 * Resolve a member by email (exact, case-insensitive), member_no, or phone.
 * Phone matching strips non-digits and accepts 07…/2547…/+2547… forms.
 * Returns null when no unique user matches.
 */
export async function resolveMemberByIdentifier(identifier: string): Promise<{
  id: string;
  email: string;
  full_name: string | null;
  member_no: string | null;
  status: string | null;
} | null> {
  const trimmed = identifier.trim();
  const digits = trimmed.replace(/\D/g, '');
  const phoneForms = new Set<string>();
  if (digits.length >= 9) {
    phoneForms.add(digits);
    if (digits.startsWith('0')) phoneForms.add(`254${digits.slice(1)}`);
    if (digits.startsWith('254')) phoneForms.add(`0${digits.slice(3)}`);
    if (!digits.startsWith('0') && !digits.startsWith('254') && digits.length === 9) {
      phoneForms.add(`0${digits}`);
      phoneForms.add(`254${digits}`);
    }
  }

  const res = await pool.query(
    `SELECT id, email, full_name, member_no, status
     FROM users
     WHERE LOWER(email) = LOWER($1)
        OR member_no = $1
        OR ($2::text[] IS NOT NULL AND REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g') = ANY($2::text[]))
     LIMIT 2`,
    [trimmed, phoneForms.size > 0 ? Array.from(phoneForms) : null]
  );

  if (res.rows.length !== 1) return null;
  return res.rows[0];
}

// ── Approval eligibility (state-machine gate for APPROVE) ────────────────────

export interface EligibilityCheck {
  key: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface EligibilityResult {
  checks: EligibilityCheck[];
  allPass: boolean;
}

/**
 * Evaluate every approve-gate rule for a PENDING loan (spec §2.4):
 *  - member is ACTIVE
 *  - savings ≥ MIN_SAVINGS_TO_BORROW
 *  - principal ≤ LOAN_LIMIT_MULTIPLE × savings
 *  - ≥ MIN_GUARANTOR_COUNT APPROVED guarantors covering ≥ 100% of principal
 *  - fewer than MAX_ACTIVE_LOANS_PER_MEMBER other non-terminal loans
 */
export async function evaluateApprovalEligibility(
  exec: QueryExecutor,
  loan: { id: string; user_id: string; amount: number | string }
): Promise<EligibilityResult> {
  const principal = Number(loan.amount);

  const borrowerRes = await exec.query(
    `SELECT status FROM users WHERE id = $1`,
    [loan.user_id]
  );
  const memberStatus = borrowerRes.rows[0]?.status ?? 'ACTIVE';

  const balance = await getSavingsBalance(exec, loan.user_id);

  const activeRes = await exec.query(
    `SELECT COUNT(*)::int AS c FROM loans
     WHERE user_id = $1 AND id <> $2 AND status IN ('PENDING','APPROVED','DISBURSED')`,
    [loan.user_id, loan.id]
  );
  const otherActiveLoans = Number(activeRes.rows[0]?.c ?? 0);

  const covRes = await exec.query(
    `SELECT COUNT(*)::int AS approved_count, COALESCE(SUM(guaranteed_amount), 0) AS approved_amount
     FROM guarantors WHERE loan_id = $1 AND status = 'APPROVED'`,
    [loan.id]
  );
  const approvedCount = Number(covRes.rows[0]?.approved_count ?? 0);
  const approvedAmount = Number(covRes.rows[0]?.approved_amount ?? 0);
  const coveragePct = principal > 0 ? Math.round((approvedAmount / principal) * 100) : 0;

  const limitMax = SACCO.LOAN_LIMIT_MULTIPLE_OF_SAVINGS * balance;

  const checks: EligibilityCheck[] = [
    {
      key: 'MEMBER_ACTIVE',
      label: 'Member account is ACTIVE',
      pass: memberStatus === 'ACTIVE',
      detail: `status=${memberStatus}`,
    },
    {
      key: 'MIN_SAVINGS',
      label: `Savings ≥ KES ${SACCO.MIN_SAVINGS_TO_BORROW.toLocaleString()}`,
      pass: balance >= SACCO.MIN_SAVINGS_TO_BORROW,
      detail: `balance=KES ${balance.toLocaleString()}`,
    },
    {
      key: 'LOAN_LIMIT',
      label: `Principal ≤ ${SACCO.LOAN_LIMIT_MULTIPLE_OF_SAVINGS}× savings (KES ${Math.round(limitMax).toLocaleString()})`,
      pass: principal <= limitMax,
      detail: `principal=KES ${principal.toLocaleString()}`,
    },
    {
      key: 'GUARANTORS',
      label: `≥${SACCO.MIN_GUARANTOR_COUNT} approved guarantors covering ≥${SACCO.MIN_GUARANTOR_COVERAGE_PCT}%`,
      pass:
        approvedCount >= SACCO.MIN_GUARANTOR_COUNT &&
        coveragePct >= SACCO.MIN_GUARANTOR_COVERAGE_PCT,
      detail: `${approvedCount} approved · ${coveragePct}% covered`,
    },
    {
      key: 'ACTIVE_LOANS',
      label: `Fewer than ${SACCO.MAX_ACTIVE_LOANS_PER_MEMBER} existing non-terminal loan(s)`,
      pass: otherActiveLoans < SACCO.MAX_ACTIVE_LOANS_PER_MEMBER,
      detail: `${otherActiveLoans} other active`,
    },
  ];

  return { checks, allPass: checks.every((c) => c.pass) };
}

// ── State machine ─────────────────────────────────────────────────────────────

/** Actions permitted from each loan status (REJECTED/REPAID are terminal). */
export function allowedActionsFor(status: string): string[] {
  switch (status) {
    case 'PENDING':
      return ['APPROVE', 'REJECT'];
    case 'APPROVED':
      return ['DISBURSE'];
    default:
      return [];
  }
}

export function assertTransition(status: string, action: string): void {
  if (!allowedActionsFor(status).includes(action)) {
    const allowed = allowedActionsFor(status);
    throw new HttpError(
      400,
      allowed.length > 0
        ? `Illegal transition: cannot ${action} a ${status} loan. Allowed actions from ${status}: ${allowed.join(', ')}`
        : `Illegal transition: ${action} — ${status} is a terminal state`
    );
  }
}

/** Terms for an existing loan row (server-side rate constant only). */
export function termsForLoan(amount: number | string, durationMonths: number): LoanTerms {
  return computeLoanTerms(Number(amount), durationMonths, SACCO.INTEREST_RATE_PCT);
}

// ── Best-effort side effects (never fail the main flow) ──────────────────────

/** Insert an in-app notification; logs instead of throwing (migration-gated). */
export async function notify(
  userId: string,
  eventType: string,
  title: string,
  body: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, event_type, title, body, meta) VALUES ($1,$2,$3,$4,$5)`,
      [userId, eventType, title, body, JSON.stringify(meta)]
    );
  } catch (error) {
    console.error(`notify(${eventType}) failed (is migration 002 applied?):`, error);
  }
}

/** Append an audit log row; logs instead of throwing (migration-gated). */
export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta) VALUES ($1,$2,$3,$4,$5)`,
      [actorId, action, entity, entityId, JSON.stringify(meta)]
    );
  } catch (error) {
    console.error(`audit(${action}) failed (is migration 002 applied?):`, error);
  }
}
