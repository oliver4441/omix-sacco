/**
 * Money formatting & rounding utilities (KES).
 * Safe to import from client components and server code alike.
 */

/**
 * Round half-up to 2 decimal places. All money arithmetic goes through this
 * so we never ship float dust to the DB or the UI.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const kesFormatter = new Intl.NumberFormat('en-KE', {
  style: 'currency',
  currency: 'KES',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format an amount (number or pg DECIMAL string) as Kenyan Shillings. */
export function formatKES(amount: number | string): string {
  const value = Number(amount);
  return kesFormatter.format(Number.isFinite(value) ? value : 0);
}

/** Compact KES rendering for chart axes: drops trailing ".00". */
export function formatKESCompact(amount: number | string): string {
  return formatKES(amount).replace(/\.00$/, '');
}

/**
 * @deprecated Legacy alias kept so unmigrated call sites keep working.
 * Use {@link formatKES} in new code.
 */
export const formatCurrency = (amount: number | string): string => formatKES(amount);
