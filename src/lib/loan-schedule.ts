/**
 * Loan term + repayment-schedule math — Omix SACCO flat-interest model.
 *
 * PURE module: no DB / server-only imports, so it is safe to use from route
 * handlers AND from client components (terms calculator preview).
 *
 * All money arithmetic runs in integer cents to avoid float drift; values are
 * converted back to KES numbers only at serialization boundaries.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REQUIRED MIGRATION (do NOT run this module's callers against a DB without it)
 * 002_phase1_core.sql per docs/IMPLEMENTATION_SPEC_PHASE_1_2.md §2.1 —
 *   ALTER TABLE loans ADD COLUMN loan_type VARCHAR(30) NOT NULL DEFAULT 'NORMAL'
 *     CHECK (loan_type IN ('NORMAL','EMERGENCY','DEVELOPMENT','EDUCATION')),
 *     ADD COLUMN total_interest DECIMAL(12,2),
 *     ADD COLUMN total_payable DECIMAL(12,2),
 *     ADD COLUMN monthly_installment DECIMAL(12,2),
 *     ADD COLUMN repaid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
 *     ADD COLUMN approved_by UUID REFERENCES users(id),
 *     ADD COLUMN approved_at TIMESTAMPTZ,
 *     ADD COLUMN rejected_reason TEXT,
 *     ADD COLUMN disbursed_at TIMESTAMPTZ,
 *     ADD COLUMN due_date DATE;
 *   ALTER TABLE guarantors ADD COLUMN guaranteed_amount DECIMAL(12,2)
 *     NOT NULL DEFAULT 0, ADD COLUMN responded_at TIMESTAMPTZ;
 *   CREATE TABLE loan_repayments (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
 *     installment_no INTEGER NOT NULL,
 *     due_date DATE NOT NULL,
 *     expected_amount DECIMAL(12,2) NOT NULL,
 *     paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
 *     status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
 *       CHECK (status IN ('PENDING','PARTIAL','PAID')),
 *     paid_at TIMESTAMPTZ,
 *     UNIQUE (loan_id, installment_no));
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Business terms mirrored from docs spec §2.2 constants (local copy — see
 * src/lib/loan-helpers.ts note about src/lib/constants.ts ownership). */
export const SACCO_TERMS = {
  /** Flat interest p.a. */
  INTEREST_RATE_PCT: 12.5,
  /** Allowed tenors in months. */
  DURATION_MONTHS: [3, 6, 9, 12, 18, 24],
} as const;

/** Convert KES amount to integer cents (half-up). */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents back to a KES number. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Round half-up to 2 dp via cents. */
export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

export interface LoanTerms {
  principal: number;
  interestRatePct: number;
  durationMonths: number;
  totalInterest: number;
  totalPayable: number;
  /** Rounded equal installment; last installment is remainder-adjusted. */
  monthlyInstallment: number;
  lastInstallment: number;
}

/**
 * Flat-interest terms:
 *   totalInterest      = round2(P × rate% × months/12)
 *   totalPayable       = P + totalInterest
 *   monthlyInstallment = round2(totalPayable / n); last = totalPayable − monthly×(n−1)
 */
export function computeLoanTerms(
  principal: number,
  durationMonths: number,
  interestRatePct: number = SACCO_TERMS.INTEREST_RATE_PCT
): LoanTerms {
  const principalCents = toCents(principal);
  if (!Number.isFinite(principalCents) || principalCents <= 0) {
    throw new Error('Principal must be a positive amount');
  }
  if (!Number.isInteger(durationMonths) || durationMonths <= 0) {
    throw new Error('Duration must be a positive whole number of months');
  }

  const totalInterestCents = Math.round(
    principalCents * (interestRatePct / 100) * (durationMonths / 12)
  );
  const totalPayableCents = principalCents + totalInterestCents;

  const monthlyCents =
    durationMonths === 1
      ? totalPayableCents
      : Math.round(totalPayableCents / durationMonths);
  const lastCents =
    durationMonths === 1
      ? totalPayableCents
      : totalPayableCents - monthlyCents * (durationMonths - 1);

  return {
    principal: fromCents(principalCents),
    interestRatePct,
    durationMonths,
    totalInterest: fromCents(totalInterestCents),
    totalPayable: fromCents(totalPayableCents),
    monthlyInstallment: fromCents(monthlyCents),
    lastInstallment: fromCents(lastCents),
  };
}

/**
 * Add `months` to an ISO date string ('YYYY-MM-DD'), clamping end-of-month
 * (e.g. 2026-01-31 + 1 month → 2026-02-28). Uses UTC throughout.
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) throw new Error(`Invalid ISO date: ${isoDate}`);
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-based
  const day = Number(m[3]);

  const targetMonthIndex0 = month - 1 + months; // 0-based, may overflow year
  const targetYear = year + Math.floor(targetMonthIndex0 / 12);
  const targetMonth0 = ((targetMonthIndex0 % 12) + 12) % 12;

  // Day count of target month: day 0 of the following month.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth0 + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth0 + 1)}-${pad(targetDay)}`;
}

export interface ScheduleRow {
  installmentNo: number;
  dueDate: string; // 'YYYY-MM-DD'
  expectedAmount: number;
}

/**
 * Build one row per installment. First installment is due one month after
 * disbursement (i = 1..n). Last installment carries the rounding remainder.
 */
export function buildSchedule(
  totalPayable: number,
  durationMonths: number,
  disbursementDateISO: string
): ScheduleRow[] {
  const totalPayableCents = toCents(totalPayable);
  const monthlyCents =
    durationMonths === 1 ? totalPayableCents : Math.round(totalPayableCents / durationMonths);
  const lastCents =
    durationMonths === 1 ? totalPayableCents : totalPayableCents - monthlyCents * (durationMonths - 1);

  const rows: ScheduleRow[] = [];
  for (let i = 1; i <= durationMonths; i++) {
    rows.push({
      installmentNo: i,
      dueDate: addMonthsClamped(disbursementDateISO, i),
      expectedAmount: fromCents(i === durationMonths ? lastCents : monthlyCents),
    });
  }
  return rows;
}
