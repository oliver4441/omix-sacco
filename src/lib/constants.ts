/**
 * Omix SACCO business rules — single source of truth.
 * Import from both API route handlers and client components.
 */
export const SACCO = {
  /** Flat interest p.a. (standard Kenyan SACCO practice). */
  INTEREST_RATE_PCT: 12.5,
  /** Allowed loan durations in months. */
  DURATION_MONTHS: [3, 6, 9, 12, 18, 24] as number[],
  /** Max loan = 3 × confirmed savings balance. */
  LOAN_LIMIT_MULTIPLE_OF_SAVINGS: 3,
  /** Minimum completed savings balance (KES) before a member may borrow. */
  MIN_SAVINGS_TO_BORROW: 5000,
  /** Minimum number of APPROVED guarantors per loan. */
  MIN_GUARANTOR_COUNT: 2,
  /** Guarantees must cover at least this % of the principal. */
  MIN_GUARANTOR_COVERAGE_PCT: 100,
  /** Non-terminal loans a member may hold at once. */
  MAX_ACTIVE_LOANS_PER_MEMBER: 1,
  /** Raise later if the board requires notice for withdrawals. */
  WITHDRAWAL_NOTICE_DAYS: 0,
};

/** Tolerance for balance comparisons — never float-compare money exactly. */
export const MONEY_EPSILON = 0.001;
