# Omix SACCO — Implementation Specification: Phase 1 & Phase 2

**Status:** Draft v1 · **Date:** 2026-08-24
**Stack:** Next.js 15 App Router · React 19 RC · TypeScript · Tailwind · PostgreSQL (Neon) via `pg` raw SQL · jose JWT (cookie `auth_token`) · zod v4 · react-hook-form · sonner · recharts · lucide-react · date-fns
**Market:** Kenyan SACCOs. Payments: M-PESA STK Push (Safaricom Daraja). Notifications: SMS (Africa's Talking).

---

## 0. Current State (verified against repo)

### What exists today

| Area | Status |
|---|---|
| Auth | Signup/login/logout/me at `src/app/api/auth/*`; bcryptjs (cost 12) + jose HS256 JWT, 7-day httpOnly cookie `auth_token`; `getSession()` in `src/lib/auth.ts` |
| Route protection | `src/middleware.ts` gates `/dashboard/**` by role, redirects authed users off `/login`/`/signup`; **matcher excludes `/api`**, so webhooks are reachable |
| Roles | DB CHECK: `'ADMIN' | 'STAFF' | 'MEMBER'` (uppercase) |
| DB access | **Raw parameterized SQL** through `query(text, params)` from `src/lib/db.ts` (pooled `pg`, Neon SSL, max 10 conns). Prisma (`prisma/schema.prisma`) + hand-written `prisma/migrations/001_init.sql` are used for DDL only |
| Models (tables) | `users`, `savings`, `loans`, `transactions`, `guarantors` — snake_case columns, UUID PKs (`gen_random_uuid()`), TIMESTAMPTZ, DECIMAL(12,2) money |
| Loan API | `GET/POST /api/loans`, `GET /api/loans/my-loans`, `PATCH /api/loans/[id]` (any-status transition by STAFF/ADMIN — no state machine) |
| Dashboards | Shells at `/dashboard/admin`, `/dashboard/staff`, `/dashboard/member` fed by `GET /api/dashboard/{stats,staff-stats,member-stats}` |
| Unused deps ready to adopt | `zod@^4`, `react-hook-form`, `sonner`, `recharts`, `date-fns`, `lucide-react` |

### Established conventions — ALL new code MUST follow these

1. **Route handlers:** named exports (`GET`, `POST`, `PATCH`), `import { NextRequest, NextResponse } from 'next/server'`. Dynamic segments use Next 15 signature: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params`.
2. **Auth guard:** first lines of every handler:
   ```ts
   const session = await getSession();
   if (!session || !allowedRoles.includes(session.role)) {
     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
   }
   ```
   (403 is not used in this codebase; keep 401 for consistency.)
3. **SQL:** always parameterized `$1..$n`; snake_case identifiers; `RETURNING *`; timestamps via `NOW()`; money stays `DECIMAL` in SQL, converted with `Number(...)` only at serialization boundaries (pg returns `DECIMAL` as string).
4. **Errors:** wrap in `try/catch`, `console.error('<context>:', error)`, respond `NextResponse.json({ error: '<human message>' }, { status })` with 400/401/404/409/500.
5. **Validation:** NEW — zod v4 (`schema.safeParse(body)` → on failure return 400 with flattened issues). Create shared schemas in `src/lib/validation/*.ts`.
6. **Enums in payloads/SQL literals are UPPERCASE** (`'PENDING'`, `'DEPOSIT'`, …) to match DB CHECK constraints.
7. **Schema changes:** update BOTH (a) `prisma/schema.prisma` (source of truth for review) and (b) a hand-written sequential script `prisma/migrations/00N_<name>.sql` applied to Neon with `psql $DATABASE_URL -f ...`. Do **not** run `prisma db push` once custom SQL lands (it will attempt to drop unknown objects).

### P0 defects to fix before Phase 1 (blocking)

- **BUG-A — Role casing mismatch:** `JWTPayload.role` is typed `'admin' | 'staff' | 'member'` and `createUser()` inserts literal `'member'`, but the DB CHECK constraint only allows `'MEMBER'` and middleware/APIs compare `'ADMIN'`/`'STAFF'` uppercase. Signup currently violates the constraint. **Fix:** uppercase everywhere; type `role: 'ADMIN' | 'STAFF' | 'MEMBER'`; insert `role.toUpperCase()`; normalize defensively on read in `authenticateUser()`: `role: user.role.toUpperCase() as JWTPayload['role']`.
- **BUG-B — Currency:** `formatCurrency()` in `src/lib/utils/helpers.ts` renders USD. Replace with KES implementation (§2.3) and migrate call sites.
- **BUG-C — Unvalidated numeric input:** `POST /api/loans` trusts `amount`/`durationMonths` from JSON (can be negative/string). Covered by zod layer §2.2.

---

## 1. Scope Overview

### Phase 1 — Core SACCO operations (no external integrations)
1. Shared foundations: zod validation schemas, KES money utils, role guard helper, audit log.
2. Savings module: deposit/withdrawal request + staff confirmation workflow, balances.
3. Loan lifecycle: state machine, guarantor workflow, flat-interest amortization schedule, disbursement & repayment tracking, loan limits tied to savings.
4. Member management for STAFF/ADMIN (list, detail, role/status management by ADMIN).
5. In-app notification center (table + API + bell UI) — plumbing that Phase 2 SMS reuses.

### Phase 2 — M-PESA payments & SMS notifications
1. Daraja client (OAuth token cache, STK Push, STK Query) with sandbox/prod switch.
2. STK-initiated savings deposits and loan repayments with idempotent callback processing + reconciliation job.
3. (Optional, flag-gated) C2B validation/confirmation endpoints for Paybill collection without STK.
4. Africa's Talking SMS: sender library, template catalog, event triggers, delivery-report webhook, queued sending via the Phase 1 notifications table.

Out of scope (later phases): payroll/checkoff integration, dividends & interest posting, ATM/FOSA, mobile app, multi-currency, statements PDF.

---

## 2. Phase 1

### 2.1 Database changes (`prisma/migrations/002_phase1_core.sql` + mirrored in `schema.prisma`)

```sql
-- users: member identity & lifecycle
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS member_no   VARCHAR(20) UNIQUE,          -- e.g. 'OMX-000123'
  ADD COLUMN IF NOT EXISTS status      VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                       CHECK (status IN ('ACTIVE','SUSPENDED','DORMANT')),
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(id);

-- backfill member_no for existing rows, then enforce NOT NULL via sequence in app layer
UPDATE users SET member_no = 'OMX-' || LPAD((ROW_NUMBER() OVER (ORDER BY created_at))::text, 6, '0')
WHERE member_no IS NULL;

-- loans: lifecycle + computed terms
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_type        VARCHAR(30) NOT NULL DEFAULT 'NORMAL'
                            CHECK (loan_type IN ('NORMAL','EMERGENCY','DEVELOPMENT','EDUCATION')),
  ADD COLUMN IF NOT EXISTS total_interest   DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS total_payable    DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS monthly_installment DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS repaid_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by      UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason  TEXT,
  ADD COLUMN IF NOT EXISTS disbursed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_date         DATE;

-- guarantors: partial guarantees
ALTER TABLE guarantors
  ADD COLUMN IF NOT EXISTS guaranteed_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responded_at      TIMESTAMPTZ;

-- repayment schedule (one row per installment)
CREATE TABLE IF NOT EXISTS loan_repayments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id         UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_no  INTEGER NOT NULL,
  due_date        DATE NOT NULL,
  expected_amount DECIMAL(12,2) NOT NULL,
  paid_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PARTIAL','PAID')),
  paid_at         TIMESTAMPTZ,
  UNIQUE (loan_id, installment_no)
);

-- in-app notifications (Phase 2 adds sms_channel fields)
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    VARCHAR(10) NOT NULL DEFAULT 'IN_APP' CHECK (channel IN ('IN_APP','SMS')),
  event_type VARCHAR(50) NOT NULL,           -- e.g. 'LOAN_APPROVED', 'GUARANTOR_REQUEST'
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  meta       JSONB NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

-- audit trail
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID REFERENCES users(id),
  action     VARCHAR(50) NOT NULL,            -- 'LOAN_APPROVE', 'WITHDRAWAL_CONFIRM', ...
  entity     VARCHAR(30) NOT NULL,            -- 'loan' | 'savings' | 'user' | ...
  entity_id  UUID,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`schema.prisma` mirrors all of the above (`@map` snake_case, new enums `UserStatus`, `LoanType`, `RepaymentStatus`, `NotificationChannel` added to enums block).

### 2.2 Shared foundations

**`src/lib/api.ts`** (new)
```ts
export function jsonError(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
export function zodFail(result: z.SafeParseReturnType<unknown, unknown>) {
  return NextResponse.json({ error: 'Validation failed', issues: result.error.flatten().fieldErrors }, { status: 400 });
}
export async function requireRole(roles: Array<'ADMIN'|'STAFF'|'MEMBER'>) {
  const session = await getSession();
  return session && roles.includes(session.role) ? session : null;
}
export function paginate(url: URL, defaults = { page: 1, pageSize: 20 }) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || String(defaults.page)));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || String(defaults.pageSize))));
  return { offset: (page - 1) * pageSize, limit: pageSize, page, pageSize };
}
```

**`src/lib/validation/index.ts`** (new) — zod schemas reused by API + react-hook-form on the client:
```ts
export const kenyanPhoneSchema = z.string()
  .transform(s => s.replace(/[\s-]/g, ''))
  .refine(s => /^(?:\+?254|0)(7|1)\d{8}$/.test(s), 'Use a valid Kenyan number, e.g. 0712345678');
export const moneySchema = z.coerce.number().positive().multipleOf(0.01).max(10_000_000);
export const signupSchema    = z.object({ email: z.string().email(), password: z.string().min(6), fullName: z.string().min(3), phone: kenyanPhoneSchema });
export const loginSchema     = z.object({ email: z.string().email(), password: z.string().min(1) });
export const createLoanSchema = z.object({
  amount: moneySchema,
  durationMonths: z.coerce.number().int().refine(v => [3,6,9,12,18,24].includes(v), 'Invalid duration'),
  purpose: z.string().max(500).optional(),
  loanType: z.enum(['NORMAL','EMERGENCY','DEVELOPMENT','EDUCATION']).default('NORMAL'),
});
export const depositSchema     = z.object({ amount: moneySchema });
export const withdrawalSchema  = z.object({ amount: moneySchema });
export const addGuarantorSchema = z.object({ identifier: z.string().min(3), guaranteedAmount: moneySchema }); // email | phone | member_no
export const guarantorDecisionSchema = z.object({ action: z.enum(['APPROVED','REJECTED']) });
export const repaymentSchema   = z.object({ amount: moneySchema });
```

**`src/lib/constants.ts`** (new) — business rules, single source of truth:
```ts
export const SACCO = {
  INTEREST_RATE_PCT: 12.5,                 // flat p.a., matches current default
  DURATION_MONTHS: [3, 6, 9, 12, 18, 24],
  LOAN_LIMIT_MULTIPLE_OF_SAVINGS: 3,       // max loan = 3 × confirmed savings balance
  MIN_SAVINGS_TO_BORROW: 5000,             // KES
  MIN_GUARANTOR_COUNT: 2,
  MIN_GUARANTOR_COVERAGE_PCT: 100,         // guarantees must cover 100% of principal
  MAX_ACTIVE_LOANS_PER_MEMBER: 1,
  WITHDRAWAL_NOTICE_DAYS: 0,               // raise later if board requires notice
};
```

**`src/lib/utils/helpers.ts`** (modify)
```ts
export const formatKES = (amount: number | string) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(Number(amount));
// keep formatCurrency as deprecated alias delegating to formatKES until call sites migrate
```

**`src/lib/audit.ts`** (new)
```ts
export async function audit(actorId: string|null, action: string, entity: string, entityId: string|null, meta: Record<string, unknown> = {}) {
  await query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, meta) VALUES ($1,$2,$3,$4,$5)`,
    [actorId, action, entity, entityId, JSON.stringify(meta)]);
}
```
Call `audit(...)` inside every successful mutating handler (after the DB write succeeds).

**`src/lib/notify.ts`** (new)
```ts
export async function notify(userId: string, eventType: string, title: string, body: string, meta: Record<string, unknown> = {}) {
  await query(`INSERT INTO notifications (user_id, event_type, title, body, meta) VALUES ($1,$2,$3,$4,$5)`,
    [userId, eventType, title, body, JSON.stringify(meta)]);
}
```
Phase 2 extends this to also enqueue SMS rows (same table, `channel='SMS'`).

**Fix BUG-A** in `src/lib/auth.ts` + `signup/route.ts`: uppercase roles end-to-end; add `phone` to signup (validated with `kenyanPhoneSchema`, normalized to `2547XXXXXXXX` storage form via `normalizePhone()` below — needed by M-PESA later).

### 2.3 Savings module

**Endpoints**

| Method & Path | Auth | Behavior |
|---|---|---|
| `POST /api/savings` | MEMBER+ | Body: `depositSchema \| withdrawalSchema` discriminated by `type` field. Deposit by MEMBER → `status='PENDING'` awaiting staff confirmation; deposit/withdrawal recorded by STAFF/ADMIN (body may include `userId`) → `'COMPLETED'` immediately with `processed_by`. Withdrawal by MEMBER → always `'PENDING'`. |
| `GET /api/savings/my` | MEMBER+ | Own ledger: `SELECT *, (running balance)` — return `{ entries, balance }` where balance = `SUM(DEPOSIT) − SUM(WITHDRAWAL)` over `status='COMPLETED'`. |
| `GET /api/savings` | STAFF, ADMIN | Query: `userId?, status?, type?, page,pageSize`. Joins `users` for names. Returns `{ entries, total, page, pageSize }`. |
| `PATCH /api/savings/[id]` | STAFF, ADMIN | Body `{ action: 'CONFIRM' | 'REJECT' }`. CONFIRM on withdrawal: recompute available balance inside a SQL transaction; if insufficient → 409 `{ error: 'Insufficient balance' }`. Sets status `COMPLETED`/`FAILED`, stamps `processed_by`, notifies owner, audits. |

**Transactionality:** confirmation paths use an explicit transaction (`const client = await pool.connect(); try { await client.query('BEGIN'); ...; await client.query('COMMIT'); } finally { client.release(); }`) so balance check + status flip are atomic. Expose a `tx(queryText, params, client?)` variant in `db.ts` or run via the checked-out client directly.

**UI**
- `src/app/dashboard/member/savings/page.tsx`: balance card (recharts area chart of cumulative balance, KES axis), deposit button (react-hook-form + sonner toast), withdrawal request form, ledger table with status badges.
- `src/app/dashboard/staff/savings/page.tsx`: pending queue (confirm/reject), manual deposit/withdrawal entry on behalf of a member (search by member_no/email).

**Acceptance criteria**
- Withdrawal can never drive a member's completed-ledger balance negative (concurrency-safe via transaction).
- Member sees own entries only; STAFF sees all; pagination caps at 100/page.

### 2.4 Loan lifecycle

**State machine (replaces free-form PATCH):**
```
PENDING ──approve──▶ APPROVED ──disburse──▶ DISBURSED ──all installments PAID──▶ REPAID
   └─reject─▶ REJECTED                (REJECTED/REPAID terminal)
```
- `approve`/`reject`: STAFF or ADMIN. Approve requires: guarantor coverage ≥ 100 % of principal with ≥ `MIN_GUARANTOR_COUNT` APPROVED guarantors, member savings ≥ `MIN_SAVINGS_TO_BORROW`, principal ≤ `LOAN_LIMIT_MULTIPLE × savings balance`, member has ≤ `MAX_ACTIVE_LOANS_PER_MEMBER` non-terminal loans, member `status='ACTIVE'`.
- `disburse`: ADMIN only (money leaves the SACCO). Stamps `disbursed_at`, sets `due_date = disbursed_at + durationMonths months`.
- `repaid` is system-set only: when the final installment reaches fully-paid during a repayment allocation.

**Terms math (flat interest — standard Kenyan SACCO practice):**
```
totalInterest = round(amount * (interestRate/100) * (durationMonths/12))
totalPayable  = amount + totalInterest
monthlyInstallment = round(totalPayable / durationMonths)   // adjust last installment by remainder
schedule[i].dueDate = disbursedAt + i months, i = 1..n       // generated at DISBURSEMENT
schedule[i].expected = monthlyInstallment (last = remainder-adjusted)
```

**Endpoints**

| Method & Path | Auth | Notes |
|---|---|---|
| `POST /api/loans` | MEMBER+ | zod `createLoanSchema`. Server recomputes `interestRate` from constants (ignore client value — fixes BUG-C). Pre-validates limit rules → 422-style 400 with specific message. Creates `PENDING` loan + `PENDING` guarantor rows if `guarantors[]` supplied. Notifies eligible guarantors. |
| `GET /api/loans` | STAFF, ADMIN | Existing route hardened: whitelist `status` values, add `page/pageSize`, `q` (member name/email/member_no ILIKE). |
| `GET /api/loans/my-loans` | MEMBER+ | Extend response: each loan includes `progress` (paid/total payable), `nextDueDate`, `overdueCount`. |
| `GET /api/loans/[id]` | owner, STAFF, ADMIN | New. Loan + user + guarantors (with names) + schedule + repayment history. Owner-only otherwise 401. |
| `PATCH /api/loans/[id]` | per-action | Body `{ action: 'APPROVE'|'REJECT'|'DISBURSE', reason? }`. Enforce matrix above. APPROVE writes `approved_by/at` + terms columns; REJECT stores reason + notifies; DISBURSE generates `loan_repayments` rows inside one transaction. |
| `POST /api/loans/[id]/repayments` | MEMBER (own, PENDING→recorded for staff confirm) / STAFF·ADMIN (immediate) | Body `repaymentSchema`. Allocation runs in a transaction: insert `savings`-style ledger entry in `transactions` (`type='LOAN_REPAYMENT'`), allocate amount across open installments oldest-first (partial fills set `PARTIAL`), update `loans.repaid_amount`, flip loan to `REPAID` when done. |

**Guarantor sub-resource**

| Method & Path | Auth | Notes |
|---|---|---|
| `POST /api/loans/[id]/guarantors` | loan owner | Resolve `identifier` → user (email exact / phone / member_no). Reject self, inactive users, duplicates (existing `@@unique([loanId, guarantorId])` → catch `23505` → 409). Validate `guaranteedAmount` ≤ guarantor's own free capacity: `MIN(savings_balance − Σ outstanding guaranteed on active loans, loan principal)`. Insert `PENDING`, notify guarantor. |
| `GET /api/guarantors/pending` | MEMBER+ | Requests addressed to me, joined with loan + borrower info. |
| `PATCH /api/guarantors/[id]` | the guarantor themself (or ADMIN) | Body `guarantorDecisionSchema`. Only while loan `PENDING`. Stamp `responded_at`, notify borrower. |
| `DELETE /api/loans/[id]/guarantors/[id]?g=<gid>` | loan owner | Remove own still-`PENDING` guarantor. |

**UI**
- `dashboard/member/loans/new/page.tsx` — multi-step form: terms calculator preview (live installment math from constants), guarantor picker with capacity hints, submit → sonner success.
- `dashboard/member/loans/[id]/page.tsx` — timeline of states, schedule table (due date, expected, paid, badge), guarantor list with statuses, repay button (cash placeholder in P1; STK button appears in P2).
- `dashboard/member/guarantor-requests/page.tsx` — approve/reject cards showing loan size, purpose, remaining capacity impact.
- `dashboard/staff/loans/page.tsx` — approval queue with one-click eligibility summary (savings, coverage %, prior loans) computed server-side and rendered as pass/fail chips; disburse button visible to ADMIN only.
- `dashboard/admin/loans/[id]` reuses the staff detail view with extra actions.

**Acceptance criteria**
- Illegal transitions return 400 with the current allowed actions listed in `error`.
- Schedule is generated exactly once per loan (guard: `INSERT ... SELECT WHERE NOT EXISTS (SELECT 1 FROM loan_repayments WHERE loan_id=$1)` inside the disburse transaction).
- Repayment allocation is idempotent per HTTP call and atomic (transaction); concurrent double-submits cannot over-allocate beyond `expected_amount` per installment (enforce with `UPDATE ... SET paid_amount = LEAST(expected_amount, paid_amount + $alloc) WHERE ... RETURNING` loop inside the tx).

### 2.5 Member management (STAFF read / ADMIN write)

| Method & Path | Auth | Notes |
|---|---|---|
| `GET /api/members` | STAFF, ADMIN | `q`, `status`, `page/pageSize`. Each row: name, member_no, email, phone, status, joined, savingsBalance (lateral subquery), activeLoanTotal. |
| `GET /api/members/[id]` | STAFF, ADMIN (or self) | Profile + balances + loan history summary + recent savings. |
| `PATCH /api/members/[id]` | ADMIN | Body `{ status?: 'ACTIVE'|'SUSPENDED'|'DORMANT', role?: 'MEMBER'|'STAFF'|'ADMIN' }`. Guard: cannot demote/exclude the last ADMIN; suspending a user does not cascade-delete financial rows (only blocks login: login + `getSession` consumers check `status='ACTIVE'`). Audited. |

Login hardening in `authenticateUser()`: after password verify, `WHERE status='ACTIVE'` else return null with distinct message “Account suspended”.

### 2.6 Notification center (in-app)

- `GET /api/notifications` (MEMBER+): latest 50, `unreadCount`.
- `PATCH /api/notifications/read` : body `{ ids: uuid[] }` or `{ all: true }` → sets `read_at`.
- UI: bell icon in `src/app/dashboard/layout.tsx` nav with unread badge; dropdown list; marks read on open. Poll every 60 s (skip SSE/websockets for now).

### 2.7 Phase 1 deliverable checklist

- [ ] BUG-A/B/C fixed; signup collects + normalizes phone.
- [ ] `002_phase1_core.sql` applied; `schema.prisma` mirrored.
- [ ] All new endpoints above implemented with zod + audit + notify.
- [ ] Member: savings page, loan application flow, loan detail, guarantor decisions.
- [ ] Staff: savings queue, loan approvals, member directory.
- [ ] Admin: everything staff has + disburse, member role/status, last-admin guard.
- [ ] `formatKES` everywhere; charts labeled in KES.

---

## 3. Phase 2

### 3.1 Environment & configuration

```bash
# .env.local (never commit; document in README)
MPESA_ENV=sandbox                                  # sandbox | production
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=174379                             # sandbox default paybill; prod = SACCO shortcode
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72d9365c0b7ef   # sandbox public passkey
MPESA_CALLBACK_BASE_URL=https://<public-host>      # must be HTTPS; ngrok in dev
AT_ENV=sandbox                                     # sandbox | production
AT_USERNAME=sandbox                                # prod = SACCO AT username
AT_API_KEY=...
AT_SENDER_ID=                                      # optional registered sender ID (prod)
CRON_SECRET=<random>                               # protects reconcile cron route
```

Middleware already excludes `/api/**` from auth redirects — webhook routes need no changes there. **Never** place Daraja credentials in client components; all calls originate from route handlers.

### 3.2 Database changes (`003_phase2_mpesa_sms.sql`)

```sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS kind                 VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
                                CHECK (kind IN ('MANUAL','STK_PUSH','C2B')),
  ADD COLUMN IF NOT EXISTS merchant_request_id  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS checkout_request_id  VARCHAR(64),
  ADD COLUMN IF NOT EXISTS result_code          INTEGER,
  ADD COLUMN IF NOT EXISTS result_desc          TEXT,
  ADD COLUMN IF NOT EXISTS raw_callback         JSONB,
  ADD COLUMN IF NOT EXISTS phone                VARCHAR(15),
  ADD COLUMN IF NOT EXISTS reference_type       VARCHAR(20),   -- 'SAVINGS' | 'LOAN'
  ADD COLUMN IF NOT EXISTS reference_id         UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_checkout ON transactions (checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_status_pending ON transactions (status) WHERE status = 'PENDING';

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS sms_status VARCHAR(20) CHECK (sms_status IN ('QUEUED','SENT','DELIVERED','FAILED')),
  ADD COLUMN IF NOT EXISTS sms_message_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
```

Mirror in `schema.prisma`. Note `mpesa_receipt` already carries `@unique` — perfect idempotency key for posted receipts.

### 3.3 Daraja client — `src/lib/mpesa/`

**`token.ts`** — OAuth with module-level cache:
```ts
let cached: { token: string; expiresAt: number } | null = null;
export async function getAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const base = baseUrl();
  const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${basic}` }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Daraja auth failed: ${res.status}`);
  const data = await res.json();                      // { access_token, expires_in }
  cached = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3599) * 1000 };
  return cached.token;
}
```

**`client.ts`**
- `baseUrl()` → `https://sandbox.safaricom.co.ke` or `https://api.safaricom.co.ke` based on `MPESA_ENV`.
- `timestamp()` → `yyyyMMddHHmmss` (UTC+3 Nairobi! use `date-fns-tz` or manual offset — **common integration bug, test it**).
- `password(ts)` → `base64(shortcode + passkey + ts)`.
- `normalizePhone(input)` → `2547XXXXXXXX` from `07…`/`+2547…`/`2547…` (reuse `kenyanPhoneSchema` transform). STK Push only succeeds against M-PESA-registered (Safaricom) numbers; treat Airtel/Telkom responses as FAILED with clear message.
- `stkPush({ amount, phone, accountReference, description })` → `POST /mpesa/stkpush/v1/processrequest`; body per Daraja spec (`BusinessShortCode`, `Password`, `Timestamp`, `TransactionType:'CustomerPayBillOnline'`, `Amount` integer KES — **round up fractional shillings, M-PESA rejects decimals**, `PartyA`, `PartyB`, `PhoneNumber`, `CallBackURL: ${MPESA_CALLBACK_BASE_URL}/api/mpesa/callback`, `AccountReference` ≤ 12 alnum chars, `TransactionDesc` ≤ 13 chars). Returns `{ MerchantRequestID, CheckoutRequestID, ResponseCode, CustomerMessage }`. Non-zero `ResponseCode` → throw with `errorMessage`.
- `stkQuery(checkoutRequestId)` → `POST /mpesa/stkpushquery/v1/query` for reconciliation; `ResultCode` `0`=paid, `1032`=cancelled/timeout, others per docs.
- Timeouts: `AbortSignal.timeout(15_000)` on every outbound fetch; retry token-once on 401 (invalidate cache, single retry).

**`callback.ts`** — parse with zod (`stkCallbackSchema`): `Body.stkCallback.{ MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata?.Item[] }`; extract `Amount(1)`, `MpesaReceiptNumber(2)`, `TransactionDate(3)`, `PhoneNumber(4)` by `Id` field lookup (items are unordered).

### 3.4 Payment initiation endpoints

| Method & Path | Auth | Behavior |
|---|---|---|
| `POST /api/mpesa/stk/deposit` | MEMBER | Body `{ amount, phone? }` (defaults to profile phone). 1) Insert `savings` row `PENDING` (DEPOSIT). 2) Insert `transactions` row `PENDING`, `kind='STK_PUSH'`, `type='SAVINGS'`, `reference_type='SAVINGS'`, `reference_id=<savings.id>`, `phone`, `amount`. 3) `stkPush(accountReference: memberNo, description: 'SACCO DEPOSIT')`; persist returned `merchant_request_id`/`checkout_request_id`. 4) Respond 202 `{ message, checkoutRequestId }`. On push failure → mark both rows FAILED, 502 with Daraja message. |
| `POST /api/mpesa/stk/repay` | MEMBER | Body `{ loanId, amount }`. Validate: caller owns loan, loan `DISBURSED`, `amount ≤ outstanding`. Same two-row pattern with `type='LOAN_REPAYMENT'`, `reference_type='LOAN'`. AccountReference = loan id short form. |
| `POST /api/mpesa/callback` | public (Daraja) | See §3.5. |
| `POST /api/cron/stk-reconcile` | header `x-cron-secret: $CRON_SECRET` | For `transactions` `PENDING` & older than 90 s: `stkQuery`; map result codes → COMPLETED/FAILED; if query itself errors, retry next tick; give up after 24 h → FAILED. Designed for Vercel Cron (`vercel.json` crons every 5 min) or any scheduler. |
| *(optional)* `POST /api/mpesa/c2b/confirmation` + `/validation` | public | Flag-gated by `ENABLE_C2B=true`. Validation: reject (ResultCode `C2B00012`) if BillRefNumber doesn't resolve to a member; Confirmation: same posting pipeline keyed on `TransID` → `mpesa_receipt` uniqueness gives idempotency. Register URLs once via `registerurl` API; document that this is skipped in Phase 2 launch if STK-only collection is acceptable. |

### 3.5 Callback processing (the critical path)

`POST /api/mpesa/callback` — must always answer fast; do heavy work synchronously but keep it bounded (< few hundred ms):

```
1. Parse+zod. Malformed → still 200 {ResultCode:'0',ResultDesc:'Accepted'} and log raw body (never 500 — Daraja retries amplify).
2. Find tx WHERE checkout_request_id = ?. None → 200 + log warning (unknown callback).
   Already COMPLETED/FAILED → 200 immediately (idempotency).
3. If ResultCode !== 0 → tx.status='FAILED', result_code/desc saved, linked savings row FAILED, notify user "payment failed", 200.
4. Success path — ONE SQL transaction:
     UPDATE transactions SET status='COMPLETED', mpesa_receipt=?, result_code=0, raw_callback=? WHERE id=? AND status='PENDING'
     -- returns rowCount 0 if a racing callback won → ROLLBACK, return 200 (idempotent)
     If reference SAVINGS: UPDATE savings SET status='COMPLETED' WHERE id=?
     If reference LOAN: run the SAME installment-allocation routine as POST /api/loans/[id]/repayments (extract to src/lib/loans/allocation.ts so both callers share it)
5. After commit: notify() user (in-app) + queue SMS "Deposit of KES X received" / "Repayment received".
6. Respond { ResultCode: 0, ResultDesc: 'Accepted' }.
```

Security notes: Daraja does **not** sign callbacks — mitigation is (a) we only trust rows we initiated via `checkout_request_id`, (b) amounts are taken from our pending row for posting decisions where they disagree, log discrepancy, (c) raw payload stored in `raw_callback` for disputes, (d) mask phone in logs (`2547****last4`).

### 3.6 SMS — `src/lib/sms/`

**`africastalking.ts`**
```ts
export async function sendSms(to: string[], message: string): Promise<Array<{ number: string; status: string; messageId?: string }>> {
  const base = process.env.AT_ENV === 'production' ? 'https://api.africastalking.com' : 'https://api.sandbox.africastalking.com';
  const res = await fetch(`${base}/version1/messaging`, {
    method: 'POST',
    headers: {
      apiKey: process.env.AT_API_KEY!,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      username: process.env.AT_USERNAME!,
      to: to.join(','),
      message,
      ...(process.env.AT_SENDER_ID ? { from: process.env.AT_SENDER_ID } : {}),
      enqueue: '1',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  // parse JSON.smsMessageData.recipients -> [{number,status,messageId,...}]
}
```

**`templates.ts`** — plain ASCII (GSM-7, avoid emoji → per-segment billing), ≤160 chars where possible, EN primary:
- `GUARANTOR_REQUEST`: “Hi {name}, {borrower} requests you to guarantee KES {amount}. Approve/reject in your Omix SACCO dashboard.”
- `LOAN_APPROVED`, `LOAN_REJECTED` (include reason), `LOAN_DISBURSED`, `REPAYMENT_RECEIVED` (incl. outstanding balance), `DEPOSIT_RECEIVED` (incl. new balance), `WITHDRAWAL_APPROVED`, `PAYMENT_FAILED`.
- Include `Reply STOP to opt out` guidance in onboarding SMS rather than every message.

**Sending pipeline** — extend `notify()`:
```
notify(userId, ..., { sms: true })
  → INSERT notifications(channel='SMS', sms_status='QUEUED', ...)
POST /api/cron/sms-dispatch  (CRON_SECRET)
  → batch QUEUED rows (≤50), group by user, render template, sendSms([...numbers], msg)
  → per-recipient status: SENT (store sms_message_id) or FAILED (retry ≤3, backoff via attempts counter in meta)
POST /api/webhooks/africastalking/delivery  (public)
  → AT posts delivery updates keyed by messageId → DELIVERED/FAILED
```
Sync-send alternative for latency-sensitive events (payment receipts) is acceptable in v1: fire-and-forget `sendSms` right after commit with the notification row written first as the audit record; reconcile job retries anything left QUEUED.

Trigger wiring points (all inside existing Phase 1 handlers): guarantor request/decision, approve/reject/disburse, manual repayment post, callback success/failure, withdrawal confirm, member suspension notice.

Compliance: sender ID registration for prod (AT dashboard), honor STOP by adding `sms_opt_out BOOLEAN` to users in `003` migration if board requires; Kenya DPC consent note documented in README.

### 3.7 Frontend additions (Phase 2)

- `dashboard/member/savings` + loan detail: **“Pay with M-PESA”** dialog (amount prefilled, phone prefilled editable) → POST STK → show “Check your phone” pending state → poll `GET /api/transactions/[id]` (new tiny endpoint, owner-only) every 3 s until COMPLETED/FAILED → sonner result. 
- `dashboard/member/payments/page.tsx`: personal STK history with receipt numbers + statuses.
- Staff/admin `transactions` list page (filter kind/status/date) for reconciliation support.
- Notification center unchanged (SMS rows shown with channel badge).

### 3.8 Phase 2 deliverable checklist

- [ ] Daraja sandbox STK deposit + repayment happy path green end-to-end (ngrok callback).
- [ ] Callback idempotency proven: replay same callback twice → single posting.
- [ ] Cancelled/timeout prompt (ResultCode 1032 / query path) → FAILED + user notified.
- [ ] Reconcile cron flips stale PENDING correctly; CRON_SECRET enforced.
- [ ] SMS delivered in sandbox for all 7 templates; QUEUED backlog drained by cron; delivery webhook updates statuses.
- [ ] No secrets in client bundles; no full MSISDNs or raw callbacks in server logs.
- [ ] `vercel.json` crons configured; production Daraja creds documented but sandbox default.

---

## 4. Cross-cutting requirements

**Money handling:** all arithmetic in `Number` after conversion from pg strings; round half-up to 2 dp via a shared `round2()`; never float-compare balances — compare with epsilon or `DECIMAL` in SQL where possible.

**Concurrency:** every multi-row invariant (withdrawal balance, repayment allocation, callback posting) runs inside `BEGIN/COMMIT` on a checked-out client. Unique constraints (`checkout_request_id`, `(loan_id, installment_no)`, `mpesa_receipt`) are the idempotency backbone; catch Postgres codes `23505` (conflict → 409) and `23503` (FK → 400).

**Testing plan (manual QA scripts per phase, automated Vitest later):**
- P1: withdraw-more-than-balance concurrently ×20; approve loan missing coverage; double disburse; last-admin demotion; suspended login.
- P2: sandbox STK success/cancel/wrong-pin; duplicate callback; reconcile sweep; AT sandbox send to test number; STOP handling if enabled.

**Sequencing estimate:** P1 ≈ 8–10 dev-days (foundations 1, savings 2, loans+guarantors 3, members+notifications 1, UI polish/QA 2). P2 ≈ 6–8 dev-days (Daraja client+endpoints 2.5, callback+allocation refactor 1.5, reconcile+cron 1, SMS 1.5, UI 1, sandbox QA 1).

**Rollout:** ship P1 behind nothing (pure internal logic), ship P2 with `MPESA_ENV=sandbox` + feature flags `ENABLE_STK=true`, `ENABLE_C2B=false`; flip to production creds after board sign-off and Paybill/live-shortcode provisioning.
