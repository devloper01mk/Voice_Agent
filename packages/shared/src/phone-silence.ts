/** Quiet-line policy for phone and simulator: 15s × 3 checks, then goodbye. */

export const SILENCE_CHECK_MS = 15_000;
export const SILENCE_CHECK_COUNT = 3;

const VOICEMAIL_RE =
  /\b(voicemail|voice\s*mail|leave\s+(?:a\s+|your\s+)?message|after\s+the\s+(?:tone|beep)|not\s+available|person\s+you(?:'re|\s+are|\s+have)?|mailbox|record\s+your\s+message|sandesh\s+chhod|uplabdh\s+nahi|available\s+nahi|tone\s+ke\s+baad|beep\s+ke\s+baad)\b|वॉइस\s*मेल|संदेश\s*छोड़|उपलब्ध\s*नहीं/i;

const NON_REPLY_RE = /^(?:beep|tone|uh+|um+|hmm+|mmm+|ah+|oh+)$/i;

/** Carrier greeting / mailbox — not a person. Leave one message and hang up. */
export function looksLikeVoicemailPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return VOICEMAIL_RE.test(t);
}

/** Real caller words. Beep, tone, and mailbox scripts do not reset the quiet clock. */
export function looksLikeHumanReply(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return false;
  if (NON_REPLY_RE.test(t)) return false;
  if (looksLikeVoicemailPrompt(t)) return false;
  return true;
}

/**
 * How many check-in lines have already been spoken this quiet stretch.
 * 0 or 1 → speak another check. 2 → third check, then the formal goodbye immediately.
 */
export function silenceStep(checksAlreadySpoken: number): 'check' | 'check_then_end' {
  return checksAlreadySpoken >= SILENCE_CHECK_COUNT - 1 ? 'check_then_end' : 'check';
}
