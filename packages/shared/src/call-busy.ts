/**
 * Busy / callback intent vs bare duration phantoms (ghost STT).
 */

function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Lone duration — often ghost STT while agent speaks; not enough for Busy. */
const BARE_DURATION =
  /^(one\s*hour|an\s*hour|1\s*hour|ek\s*(ghanta|ghante|hour)|half\s*(an\s*)?hour|aadha\s*(ghanta|hour)|\d{1,2}\s*(min(ute)?s?|minutes?|hours?|ghante?|sec(ond)?s?))\s*[.!?]*$/i;

const CLEAR_BUSY =
  /\b(busy|meeting|driving|call\s*later|call\s*back|callback|baad\s*mein(\s*call|\s*phone)?|thodi?\s*der\s*baad|baad\s*mein\s*phone|later\s*please|not\s*a\s*good\s*time|time\s*nahi|call\s*me\s*in|ek\s*ghante?\s*baad\s*call|phone\s*karna|schedule\s*(a\s*)?callback)\b|थोड़ी\s*देर\s*बाद|(?:फ़ो|फ)ोन\s*कर|कॉल\s*कर|baad\s*mein\s*call\s*k/i;

export function isBareDurationTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return BARE_DURATION.test(t);
}

export function isClearBusyOrCallbackTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return CLEAR_BUSY.test(t);
}

/** Mute phantom bare-duration turns (no LLM reply). */
export function shouldMuteBareDurationTurn(text: string): boolean {
  return isBareDurationTurn(text) && !isClearBusyOrCallbackTurn(text);
}

/** Thin hint when caller wants a later phone call — LLM chooses wording + schedule_callback. */
export function buildCallbackSystemNote(): string {
  return (
    '[SYSTEM: Caller wants a CALLBACK later (busy now / call me later / baad mein phone). ' +
    'This is NOT DNC and NOT a permanent refusal — do NOT say you will never call again. ' +
    'Acknowledge briefly, ask ONE preferred callback time if not given, then use schedule_callback. ' +
    'Do NOT use capture_demo_lead for a phone callback. Do NOT end_call until callback is saved or they decline.]'
  );
}

export function buildBareDurationBusySafetyNote(): string {
  return (
    '[SYSTEM: Bare time duration only — do NOT treat as busy/callback. ' +
    'Do not schedule_callback. Continue the last product topic or ask one short clarify about the car.]'
  );
}

/** Garbled short STT junk (e.g. Metro Bhee). */
export function looksLikeGarbageTranscript(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  // "Metro Bhee" style: two short latin tokens, no known sales/ack words
  if (
    words.length === 2 &&
    /^[A-Za-z]+$/.test(words[0]!) &&
    /^[A-Za-z]+$/.test(words[1]!) &&
    words[0]!.length <= 8 &&
    words[1]!.length <= 8 &&
    !/\b(suv|sedan|car|cars|yes|yeah|yep|no|nahi|ok|okay|hi|hello|virtus|taigun|tiguan|price|demo|emi)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

export function buildUnclearSpeechClarifySystemNote(productName: string): string {
  return (
    `[SYSTEM: Transcript looks unclear/garbled or low-confidence. ` +
    `Ask ONE short soft clarify in sticky call language (e.g. sedan vs SUV / what they need for ${productName}). ` +
    `Do NOT treat as off-topic. Do NOT treat as busy/callback. Do NOT invent facts.]`
  );
}
