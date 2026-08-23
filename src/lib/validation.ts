import { z } from 'zod';
import { SACCO } from '@/lib/constants';

/**
 * Shared zod schemas — used by API route handlers (safeParse → 400 with
 * flattened issues) and by react-hook-form forms on the client.
 * Written against the zod v3 API surface that is also valid under v4.
 */

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Positive KES amount, max 2 dp, capped at KES 10,000,000. */
export const moneySchema = z.coerce
  .number()
  .positive('Amount must be greater than zero')
  .multipleOf(0.01, 'Amount can have at most 2 decimal places')
  .max(10000000, 'Amount exceeds the maximum of KES 10,000,000');

export const uuidSchema = z.string().uuid('Invalid identifier');

/**
 * Kenyan phone: accepts 07.. / 01.. / +2547.. / 2547.. with optional
 * spaces or dashes; transforms to the bare local/international form.
 */
export const kenyanPhoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ''))
  .refine((s) => /^(?:\+?254|0)(7|1)\d{8}$/.test(s), {
    message: 'Use a valid Kenyan number, e.g. 0712345678',
  });

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const signupSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  fullName: z.string().min(3, 'Full name must be at least 3 characters'),
  phone: kenyanPhoneSchema,
});

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

/* ------------------------------------------------------------------ */
/* Savings                                                             */
/* ------------------------------------------------------------------ */

export const depositSchema = z.object({
  type: z.literal('DEPOSIT'),
  amount: moneySchema,
  /** STAFF/ADMIN only: record on behalf of another member. */
  userId: uuidSchema.optional(),
});

export const withdrawalSchema = z.object({
  type: z.literal('WITHDRAWAL'),
  amount: moneySchema,
  /** STAFF/ADMIN only: record on behalf of another member. */
  userId: uuidSchema.optional(),
});

/** POST /api/savings body — discriminated by `type`. */
export const savingsRequestSchema = z.discriminatedUnion('type', [
  depositSchema,
  withdrawalSchema,
]);

/** PATCH /api/savings/[id] body — staff confirmation workflow. */
export const savingsDecisionSchema = z.object({
  action: z.enum(['CONFIRM', 'REJECT']),
  reason: z.string().trim().max(500, 'Reason is too long').optional(),
});

/** GET /api/savings query filters (staff/admin list view). */
export const savingsListQuerySchema = z.object({
  userId: uuidSchema.optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).optional(),
  type: z.enum(['DEPOSIT', 'WITHDRAWAL']).optional(),
});

/* ------------------------------------------------------------------ */
/* Loans & guarantors                                                  */
/* ------------------------------------------------------------------ */

export const createLoanSchema = z.object({
  amount: moneySchema,
  durationMonths: z.coerce
    .number()
    .int()
    .refine((v) => SACCO.DURATION_MONTHS.includes(v), {
      message: `Duration must be one of ${SACCO.DURATION_MONTHS.join(', ')} months`,
    }),
  purpose: z.string().max(500, 'Purpose is too long').optional(),
  guarantors: z
    .array(
      z.object({
        identifier: z.string().min(3, 'Provide email, phone or member number'),
        guaranteedAmount: moneySchema,
      })
    )
    .max(5, 'At most 5 guarantors per loan')
    .optional(),
  loanType: z.enum(['NORMAL', 'EMERGENCY', 'DEVELOPMENT', 'EDUCATION']).default('NORMAL'),
});

export const addGuarantorSchema = z.object({
  /** email | phone | member_no */
  identifier: z.string().min(3),
  guaranteedAmount: moneySchema,
});

export const guarantorDecisionSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED']),
});

export const repaymentSchema = z.object({ amount: moneySchema });

/* ------------------------------------------------------------------ */
/* Inferred types                                                      */
/* ------------------------------------------------------------------ */

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;
export type SavingsRequestInput = z.infer<typeof savingsRequestSchema>;
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
