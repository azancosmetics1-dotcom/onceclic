/**
 * Centralized Email Normalization Utility
 * Guarantees identical canonical comparison across registration, login,
 * trial eligibility checks, trial redemption, and database constraints.
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') {
    return '';
  }
  return email.trim().toLowerCase();
}
