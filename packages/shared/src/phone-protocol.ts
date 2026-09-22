import { normalizeSpokenPhone } from './phone-utils.js';

const PHONE_ASK_RE =
  /\b(phone|mobile|whatsapp|contact\s*number|10[\s-]*digits?|digit\s*by\s*digit|one\s*by\s*one|phone\s*number|whatsapp\s*number|mobile\s*number)\b|\bnumber\b.{0,40}\b(dobara|share|boliye|batao|bataiye|chahiye|short|digits?)\b|नंबर|मोबाइल|फ़ोन|फोन/i;

/** True when the assistant turn is asking for or confirming a phone number. */
export function agentTurnRequestedPhoneCapture(assistantText: string): boolean {
  const t = assistantText.trim();
  if (!t) return false;
  return PHONE_ASK_RE.test(t);
}

export function isPhoneCaptureActive(
  lastAssistantTurn: string,
  recentAssistantTurns: string[] = [],
): boolean {
  if (agentTurnRequestedPhoneCapture(lastAssistantTurn)) return true;
  return recentAssistantTurns.slice(-4).some((t) => agentTurnRequestedPhoneCapture(t));
}

/** Phone protocol when the assistant recently asked for a number. */
export function shouldRunPhoneProtocol(
  lastAssistantTurn: string,
  recentAssistantTurns: string[] = [],
): boolean {
  return isPhoneCaptureActive(lastAssistantTurn, recentAssistantTurns);
}

/** Digit utterance that looks like an Indian mobile (not email-like). */
export function looksLikePhoneDigitUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/@/.test(t) || /\b(gmail|yahoo|outlook|hotmail|icloud|dot\s*com|at\s+the\s+rate)\b/i.test(t)) {
    return false;
  }
  if (/डॉट|डोट|एट\s+द\s+रेट/u.test(t)) return false;
  const digits = normalizeSpokenPhone(t);
  if (/^[6-9]\d{9}$/.test(digits)) return true;
  if (digits.length >= 8 && digits.length <= 12) {
    const latin = t.replace(/[^\w.@+-]/g, '');
    if (/^\d+$/.test(latin) || /^[\d\s,.-]+$/.test(t)) return true;
  }
  return false;
}
