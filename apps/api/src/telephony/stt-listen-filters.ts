/** Hello/hi after our own TTS is usually echo. Inbound first hello is real speech. */
export const GREETING_ECHO_RE = /^(hello+|hi+|hey+|namaste|namaskar|हैलो+|नमस्ते)[\s.?!।]*$/i;
export const GREETING_ECHO_WINDOW_MS = 2_500;

/** Azure often emits 3–4 digit fragments on hush. */
const LEADING_SHORT_NUMBER_NOISE = /^(?:\d{3,4}[\s,/.-]+)+/;
const SHORT_NUMBER_ONLY = /^\d{3,4}(?:[\s,/.-]+\d{3,4}){0,3}[\s.!?।]*$/;

export function isShortNumberSttNoise(text: string): boolean {
  return SHORT_NUMBER_ONLY.test(text.trim());
}

/** "100 140 हाँ जी बोलिए" → "हाँ जी बोलिए". Leaves "2 minute" / "10 lakh" alone. */
export function stripLeadingSttNumberNoise(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || isShortNumberSttNoise(trimmed)) return trimmed;
  const stripped = trimmed.replace(LEADING_SHORT_NUMBER_NOISE, '').trim();
  if (stripped && /[a-zA-Z\u0900-\u097F]/.test(stripped)) return stripped;
  return trimmed;
}

export function isGreetingEchoTranscript(
  text: string,
  speakStartedAt: number,
  now = Date.now(),
  opts?: { playing?: boolean },
): boolean {
  if (!GREETING_ECHO_RE.test(text.trim())) return false;
  if (!speakStartedAt) return false;
  if (opts?.playing) return true;
  return now - speakStartedAt < GREETING_ECHO_WINDOW_MS;
}
