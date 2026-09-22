/** Minimal RFC-shaped email check for API / lead saves (no conversational capture). */
export const RFC_EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export type LeadEmailValidation =
  | {
      ok: true;
      email: string;
      corrected: boolean;
      correctionNote?: string;
      needsConfirm?: boolean;
      needsSpellMode?: boolean;
      suggestedDomain?: string;
    }
  | { ok: false; error: string; hint?: string };

export function validateLeadEmail(raw: string, _knownDomains: string[] = []): LeadEmailValidation {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return {
      ok: false,
      error: 'Email is empty',
      hint: 'Provide a valid email address',
    };
  }

  if (!RFC_EMAIL_REGEX.test(trimmed)) {
    if (!trimmed.includes('@')) {
      return {
        ok: false,
        error: 'Invalid email: missing @',
        hint: 'Provide a valid email address',
      };
    }
    if (!trimmed.includes('.')) {
      return {
        ok: false,
        error: 'Invalid email: missing domain extension',
        hint: 'Provide a valid email address',
      };
    }
    return {
      ok: false,
      error: 'Invalid email format',
      hint: 'Provide a valid email address',
    };
  }

  return {
    ok: true,
    email: trimmed,
    corrected: false,
  };
}

/**
 * True when capture_demo_lead must refuse until email_confirmed.
 * Kept for API compatibility; bookings use email_skipped instead.
 */
export function emailRequiresCallerConfirm(
  validatedEmail: string,
  emailConfirmed: boolean | undefined,
  knownEmail?: string | null,
): boolean {
  if (emailConfirmed) return false;
  const known = knownEmail?.trim();
  if (known && validatedEmail.toLowerCase() === known.toLowerCase()) return false;
  return true;
}
