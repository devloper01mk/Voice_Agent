/**
 * Call-level language: explicit lock (highest priority) + soft sticky inference
 * from caller speech so TTS/numbers/time follow English vs Hinglish without
 * requiring "talk in English".
 */

export type CallLanguageLock = 'en' | 'hinglish';
export type CallSpeechLanguage = 'en' | 'hinglish';

const EXPLICIT_ENGLISH =
  /\b((can|could|shall|may)\s+we\s+(talk|speak|continue)\s+in\s+english|talk\s+in\s+english|speak\s+(in\s+)?english|speaking\s+english|english\s+(mein|me)\s+(baat|bolo|bol)|in\s+english\s+(please|pls)?|switch\s+to\s+english|english\s+please|only\s+english|don'?t\s+know\s+hindi|do\s+not\s+know\s+hindi|no\s+hindi)\b|इंग्लिश|english\s*में/i;

const EXPLICIT_HINGLISH_OR_HINDI =
  /\b((can|could|shall|may)\s+we\s+(talk|speak|continue)\s+in\s+(hindi|hinglish)|talk\s+in\s+(hindi|hinglish)|speak\s+(in\s+)?(hindi|hinglish)|hindi\s+(mein|me)\s+(baat|bolo|bol|batao|bataiye)|hinglish\s+(mein|me)\s+(baat|bolo|bol|batao|bataiye)|switch\s+to\s+(hindi|hinglish)|hindi\s+please|hinglish\s+please|english\s+mein\s+kyun|english\s+me\s+kyun)\b|हिंदी|हिन्दी|हिंदी\s*में|इंग्लिश\s*में\s*क्यों/i;

const HINGLISH_WORD =
  /\b(haan|haanji|nahi|nahin|kya|aap|apka|apke|hai|hain|main|mujhe|chahiye|theek|thik|acha|accha|ji|kaise|kab|kyun|bahut|abhi|bas|suniye|batao|bataiye|samajh|dekho|zaroor|shayad|bilkul|thoda|baja|baje|subah|shaam|kal|aaj)\b/i;

/** Short English that must not flip a Hinglish call (acks + tiny fragments). */
const SHORT_ENGLISH_KEEP_HINGLISH =
  /^(ok(ay)?|yes|yeah|yep|sure|yes\s+(sir|ma'?am|mam|madam)|no|all\s+good|ok\s+all\s+good|alright|hello|hi|hey|i'?m\s+saying\b.*|no\s+\w+\s+driving)$/i;

/** Once Hinglish is sticky, only a longer clear English turn may soft-flip. */
const HINGLISH_TO_ENGLISH_MIN_WORDS = 6;

const NUMBERS_TIME_RULE_EN =
  'Times, prices, weight/height/age, and natural quantities in English only ("two o\'clock", "2 PM", "one thirty PM", "ten", "ten lakh", "nine hundred fifty", "forty-five") — never Hindi/Hinglish quantity or clock words: forbidden "das", "do baje", "das baje", "das lakh", "teen baje", "ek baje". ' +
  'Use English: ten / ten lakh / two o\'clock / 2 PM / forty-five — never say "das" for 10; never digit-spell weight (no "four five" for 45). ' +
  'Never write clock times with a colon when speaking (no "1:00 PM", never say "colon") — use "1 PM" / "one thirty PM" / "twelve PM". ' +
  'Phone, OTP, and PIN ONLY as English digit words one-by-one or in pairs (zero–nine) — never "nine hundred"/"nau sau", and never "double"/"triple" (say "two two", not "double two"). ' +
  'When the caller speaks numbers: treat price/amount/weight/height/age as natural English; treat phone/OTP/PIN as digit sequences.';

const NUMBERS_TIME_RULE_HI =
  'Times, prices, weight/height/age, and natural quantities in polished Roman Hinglish ("do baje", "das baje", "derh baje", "das lakh", "nau sau pachas", "paintalis"). ' +
  'Never write clock times with a colon when speaking (no "1:00 PM", never say "colon") — use "ek baje" / "derh baje" / "barah baje". Never digit-spell weight (45 → "paintalis" / "forty-five", not "four five"). ' +
  'Phone, OTP, and PIN ONLY as English digit words (one, two, three… nine, zero) — never Hindi digit names, never "nau sau", and never "double"/"triple" (say "two two", not "double two"). ' +
  'When the caller speaks numbers: treat price/amount/weight/height/age as natural Hindi/Hinglish; treat phone/OTP/PIN as digit sequences (English or Hindi digit words both map to digits).';
function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Map Azure / locale-style locale strings to speech language. */
export function speechLanguageFromSttLocale(
  locale: string | null | undefined,
): CallSpeechLanguage | null {
  if (!locale?.trim()) return null;
  const l = locale.trim().toLowerCase();
  if (l === 'hi' || l.startsWith('hi-') || l === 'hindi') return 'hinglish';
  if (l === 'en' || l.startsWith('en-') || l === 'english') return 'en';
  return null;
}

/** Caller explicitly asked to speak English. */
export function isExplicitEnglishRequest(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return EXPLICIT_ENGLISH.test(t);
}

/** Caller explicitly asked to speak Hindi / Hinglish. */
export function isExplicitHinglishOrHindiRequest(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return EXPLICIT_HINGLISH_OR_HINDI.test(t);
}

/**
 * Infer language for a single turn from transcript (+ optional STT locale).
 * Returns null when ambiguous (short / mixed / product-only English fragments).
 */
export function inferTurnSpeechLanguage(
  text: string,
  sttLocale?: string | null,
): CallSpeechLanguage | null {
  const t = normalizeTurn(text);
  if (!t) return null;

  if (/[\u0900-\u097F]/.test(t)) return 'hinglish';

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const hinglishHits = words.filter((w) => HINGLISH_WORD.test(w)).length;
  const latinOnly = /^[\x00-\x7F\s.,!?'"\-:+%/]+$/.test(t);

  if (hinglishHits >= 1) return 'hinglish';

  if (SHORT_ENGLISH_KEEP_HINGLISH.test(t.replace(/[.,!?']/g, ''))) return null;

  if (latinOnly && hinglishHits === 0 && words.length >= 3) {
    // Sustained clear English (not a one-word ack).
    return 'en';
  }

  if (latinOnly && hinglishHits === 0 && words.length >= 2) {
    const fromStt = speechLanguageFromSttLocale(sttLocale);
    if (fromStt) return fromStt;
  }

  // One-word acks ("Hello.", "ok") — ambiguous; do not drive soft language via STT locale.
  return null;
}

/**
 * Update lock from this user turn.
 * Explicit English → 'en'. Explicit Hindi/Hinglish → 'hinglish'.
 * Otherwise keep previous lock (null stays null).
 */
export function updateCallLanguageLock(
  text: string,
  current: CallLanguageLock | null,
): CallLanguageLock | null {
  if (isExplicitEnglishRequest(text)) return 'en';
  if (isExplicitHinglishOrHindiRequest(text)) return 'hinglish';
  // Hindi script on a call that is not English-locked stays Hindi for the rest of the call.
  if (current !== 'en' && /[\u0900-\u097F]/.test(text)) return 'hinglish';
  return current;
}

/**
 * Soft sticky language from caller speech (ignored when an explicit lock is set).
 * Clear turns update; ambiguous turns keep the previous soft value.
 * Once Hinglish is sticky, only flip to English on a clear ≥6-word Latin turn
 * (not short acks like "Hello.", "ok all good", "no city driving").
 */
export function updateSoftSpeechLanguage(
  text: string,
  current: CallSpeechLanguage | null,
  sttLocale?: string | null,
): CallSpeechLanguage | null {
  const inferred = inferTurnSpeechLanguage(text, sttLocale);
  if (!inferred) return current;

  if (current === 'hinglish' && inferred === 'en') {
    const t = normalizeTurn(text);
    const stripped = t.replace(/[.,!?']/g, '');
    if (SHORT_ENGLISH_KEEP_HINGLISH.test(stripped)) return current;
    const words = t.split(/\s+/).filter(Boolean);
    const hinglishHits = words.filter((w) => HINGLISH_WORD.test(w)).length;
    const latinOnly = /^[\x00-\x7F\s.,!?'"\-:+%/]+$/.test(t);
    if (!(latinOnly && hinglishHits === 0 && words.length >= HINGLISH_TO_ENGLISH_MIN_WORDS)) {
      return current;
    }
  }

  return inferred;
}

/** Key for whether we already injected a CALL LANGUAGE / LANGUAGE LOCK note. */
export type LanguageGuidanceKey = `lock:${CallLanguageLock}` | `soft:${CallSpeechLanguage}`;

export function languageGuidanceKey(
  lock: CallLanguageLock | null,
  soft: CallSpeechLanguage | null,
): LanguageGuidanceKey | null {
  if (lock) return `lock:${lock}`;
  if (soft) return `soft:${soft}`;
  return null;
}

/**
 * Append CALL LANGUAGE / LANGUAGE LOCK note only when the guidance key changed.
 * Avoids repeating the same ~200–400 char policy on every user turn in history.
 */
export function appendLanguageGuidanceIfChanged(
  baseContent: string,
  lock: CallLanguageLock | null,
  soft: CallSpeechLanguage | null,
  lastInjectedKey: LanguageGuidanceKey | null,
): { content: string; injectedKey: LanguageGuidanceKey | null } {
  const key = languageGuidanceKey(lock, soft);
  if (!key || key === lastInjectedKey) {
    return { content: baseContent, injectedKey: lastInjectedKey };
  }
  const note = lock
    ? buildLanguageLockSystemNote(lock)
    : buildSpeechLanguageSystemNote(soft!);
  return {
    content: `${baseContent}\n\n${note}`,
    injectedKey: key,
  };
}

/** Lock wins; otherwise soft sticky inference. */
export function effectiveSpeechLanguage(
  lock: CallLanguageLock | null,
  soft: CallSpeechLanguage | null,
): CallSpeechLanguage | null {
  return lock ?? soft;
}

/** TTS locale for a speech language / lock. */
export function ttsLocaleForLock(lock: CallLanguageLock | CallSpeechLanguage | null): 'en' | 'hi' | null {
  if (lock === 'en') return 'en';
  if (lock === 'hinglish') return 'hi';
  return null;
}

/** Injected when caller explicitly locked the language. */
export function buildLanguageLockSystemNote(lock: CallLanguageLock): string {
  if (lock === 'en') {
    return (
      '[SYSTEM: LANGUAGE LOCK = ENGLISH. The caller explicitly asked to speak English. ' +
      'Reply in polished English only for the rest of this call until they explicitly ask for Hindi/Hinglish. ' +
      'Do NOT switch to Hinglish or Hindi because of mixed/garbled STT, Devanagari transcript, or Hindi words in their latest turn. ' +
      'Never start with "Aap", "Ji", or Hinglish verbs. ' +
      NUMBERS_TIME_RULE_EN +
      ']'
    );
  }
  return (
    '[SYSTEM: LANGUAGE LOCK = HINGLISH. The caller explicitly asked for Hindi/Hinglish. ' +
    'Reply in polished Roman Hinglish only until they explicitly ask for English. Never Devanagari. ' +
    'No Urdu words (never "alvida", "shukriya", "mazeed", "khuda hafiz" — say "bye" / "dhanyavaad" / "aur" / "zyada"). ' +
    NUMBERS_TIME_RULE_HI +
    ']'
  );
}

/**
 * Injected when soft sticky language is set (no explicit lock).
 * Keeps times/numbers/phone aligned with the caller's spoken language.
 */
export function buildSpeechLanguageSystemNote(lang: CallSpeechLanguage): string {
  if (lang === 'en') {
    return (
      '[SYSTEM: CALL LANGUAGE = ENGLISH (from caller speech). ' +
      'Reply in polished English. ' +
      NUMBERS_TIME_RULE_EN +
      ' Switch to Hinglish only after an explicit Hindi/Hinglish request.]'
    );
  }
  return (
    '[SYSTEM: CALL LANGUAGE = HINGLISH (from caller speech). ' +
    'Reply in polished Roman Hinglish. Never Devanagari. ' +
    'No Urdu words (never "alvida", "shukriya", "mazeed", "khuda hafiz" — say "bye" / "dhanyavaad" / "aur" / "zyada"). ' +
    NUMBERS_TIME_RULE_HI +
    ' Switch to English only after an explicit English request.]'
  );
}
