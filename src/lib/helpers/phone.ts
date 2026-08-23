/**
 * Kenyan phone number helpers (storage form: 2547XXXXXXXX / 2541XXXXXXXX).
 * Needed later by M-PESA STK Push; signup normalizes to this form.
 */

const KENYAN_MSISDN = /^254(7|1)\d{8}$/;

/**
 * Normalize any accepted input form — 07.., 01.., +2547.., 2547..,
 * with optional spaces/dashes/parens — to `2547XXXXXXXX`.
 * Returns null when the input is not a valid Kenyan mobile number.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s()\-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  return KENYAN_MSISDN.test(digits) ? digits : null;
}

/** Mask for logs: 254712****34 — never log full MSISDNs. */
export function maskPhone(phone: string): string {
  if (phone.length < 8) return '****';
  return `${phone.slice(0, 6)}****${phone.slice(-4)}`;
}
