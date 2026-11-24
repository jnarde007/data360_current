/**
 * Shared validation helpers for DATA360 forms.
 *
 * Phone rule: ONLY local Ghana 10-digit numbers, starting with 0.
 *   ✓ 0241234567, 0541234567, 0201234567
 *   ✗ 233241234567, +233241234567, 24123456 (any non-10-digit local format)
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Strict Ghana local: 10 digits, starts with 0, second digit 2/3/5
const GH_PHONE_RE = /^0[235]\d{8}$/;

export const PHONE_ERROR_MESSAGE =
  'Please enter a valid 10-digit phone number starting with 0.';

/**
 * Clean a phone input to a Ghana local 10-digit format.
 * - Strips all non-digit characters (spaces, dashes, brackets, '+', letters, etc.)
 * - Converts international Ghana prefixes (+233 / 233) to local 0-prefix
 * - Caps the result at 10 digits
 *
 *   "054 395 7482"       → "0543957482"
 *   "054-395-7482"       → "0543957482"
 *   "(054) 395 7482"     → "0543957482"
 *   "+233 54 395 7482"   → "0543957482"
 *   "233543957482"       → "0543957482"
 */
export function normalizePhone(input: string): string {
  let digits = (input || '').replace(/\D+/g, '');
  // Handle Ghana international prefix: 233XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('233') && digits.length >= 12) {
    digits = '0' + digits.slice(3);
  } else if (digits.startsWith('233') && digits.length > 10) {
    // partial paste like "23354395748" — still convert
    digits = '0' + digits.slice(3);
  }
  return digits.slice(0, 10);
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Email is required';
  if (!EMAIL_RE.test(trimmed)) return 'Enter a valid email address';
  return null;
}

export function validatePhone(phone: string): string | null {
  const cleaned = normalizePhone(phone);
  if (!cleaned) return 'Phone number is required';
  if (!GH_PHONE_RE.test(cleaned)) return PHONE_ERROR_MESSAGE;
  return null;
}

/** Returns true when phone passes the strict 10-digit local rule. */
export function isValidPhone(phone: string): boolean {
  return GH_PHONE_RE.test(normalizePhone(phone));
}

export function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Full name is required';
  if (trimmed.length < 2) return 'Full name must be at least 2 characters';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  if (password.length < 6) return 'Password must be at least 6 characters';
  return null;
}
