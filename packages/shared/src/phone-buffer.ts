import { digitsToWords, formatPhoneForSpeech, normalizeSpokenPhone } from './phone-utils.js';

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;

export type PhoneBufferState = {
  /** Digits collected so far (0–12). Never invent digits to pad to 10. */
  digits: string;
  /** Messy / conflicting ingest attempts while capture is active. */
  failedAttempts: number;
};

export type PhoneIngestKind =
  | 'idle'
  | 'empty'
  | 'partial'
  | 'complete'
  | 'too_long'
  | 'conflict'
  | 'letters'
  | 'confirm_ready'
  | 'escalate';

export type PhoneIngestResult = {
  state: PhoneBufferState;
  kind: PhoneIngestKind;
  /** Competing full number when kind === 'conflict'. */
  conflictWith?: string;
  systemNote: string;
};

export function emptyPhoneBuffer(): PhoneBufferState {
  return { digits: '', failedAttempts: 0 };
}

/** Caller affirming a read-back. */
export function isPhoneConfirmCue(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return /^(haan|han|haaji|ha|yes|yeah|yep|sahi|theek|correct|right|ok|okay|bilkul)\b/i.test(t)
    || /\b(sahi\s*hai|theek\s*hai|yeh\s*sahi|that's\s*right|that\s*is\s*correct)\b/i.test(t);
}

/** Caller rejecting a read-back. */
export function isPhoneRejectCue(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /\b(nahi|nahin|galat|wrong|incorrect|nope|not\s*right|गलत|नहीं)\b/i.test(t);
}

/**
 * Detect "aage 8 nahi laga" / "pehle eight" style leading-digit patches.
 * Returns digits to prepend, or null.
 */
export function detectLeadingDigitPatch(utterance: string): string | null {
  const raw = utterance.trim();
  if (!raw) return null;

  const leading =
    raw.match(
      /(?:aage|pehle|shuru(?:\s*mein)?|start(?:ing)?(?:\s+with)?)\s*(?:mein\s*)?(?:toh\s*)?(?:nahi\s*laga\s*)?(?:hai\s*)?(?:to\s*)?([0-9०-९]|zero|oh|one|two|three|four|five|six|seven|eight|nine|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau|एट|आठ|जीरो|शून्य)/i,
    ) ??
    raw.match(
      /([0-9०-९]|eight|aath|एट|आठ)\s*(?:aage|pehle).{0,24}(?:nahi|nahin|missing|miss|नहीं)/i,
    );

  if (!leading?.[1]) return null;
  const digits = normalizeSpokenPhone(leading[1]);
  return digits || null;
}

/** Merge existing notepad digits with a new spoken chunk (Indian sales desk style). */
export function mergePhoneDigits(existing: string, incoming: string): {
  digits: string;
  kind: Exclude<PhoneIngestKind, 'idle' | 'letters' | 'confirm_ready' | 'escalate' | 'empty'>;
  conflictWith?: string;
} {
  const prev = existing.replace(/\D/g, '');
  const next = incoming.replace(/\D/g, '');
  if (!next) {
    return {
      digits: prev,
      kind: prev.length === 10 && INDIAN_MOBILE_RE.test(prev) ? 'complete' : 'partial',
    };
  }
  if (!prev) {
    return classifyLength(next);
  }

  if (INDIAN_MOBILE_RE.test(next)) {
    if (prev === next || next.startsWith(prev) || prev.startsWith(next.slice(0, Math.min(prev.length, 6)))) {
      return { digits: next, kind: 'complete' };
    }
    if (prev.length >= 4) {
      const prefixLen = Math.min(4, prev.length);
      if (!next.startsWith(prev.slice(0, prefixLen))) {
        return { digits: prev, kind: 'conflict', conflictWith: next };
      }
    }
    return { digits: next, kind: 'complete' };
  }

  if (next.startsWith(prev)) {
    return classifyLength(next);
  }
  if (prev.startsWith(next) && next.length < prev.length) {
    return classifyLength(prev);
  }

  // Shared boundary digit(s): 8306 + 6446999 → 8306446999
  const maxOverlap = Math.min(prev.length, next.length, 4);
  for (let overlap = maxOverlap; overlap >= 1; overlap--) {
    if (prev.endsWith(next.slice(0, overlap))) {
      return classifyLength(prev + next.slice(overlap));
    }
  }

  const appended = prev + next;
  if (appended.length <= 10) {
    return classifyLength(appended);
  }

  if (next.length >= 8 && next.length >= prev.length) {
    return { digits: prev, kind: 'conflict', conflictWith: next.slice(0, 12) };
  }

  return classifyLength(appended);
}

function classifyLength(digits: string): {
  digits: string;
  kind: 'partial' | 'complete' | 'too_long';
} {
  const d = digits.replace(/\D/g, '').slice(0, 12);
  if (d.length > 10) return { digits: d, kind: 'too_long' };
  if (d.length === 10 && INDIAN_MOBILE_RE.test(d)) return { digits: d, kind: 'complete' };
  if (d.length === 10) return { digits: d, kind: 'too_long' }; // invalid start digit — treat as needs recheck
  return { digits: d, kind: 'partial' };
}

function spokenBuffer(digits: string): string {
  if (!digits) return '(none)';
  return digitsToWords(digits, 'en');
}

function remainingCount(digits: string): number {
  return Math.max(0, 10 - digits.length);
}

/**
 * Ingest one caller utterance into the phone notepad while capture is active.
 * Never invents digits to force length 10.
 */
export function ingestPhoneUtterance(
  state: PhoneBufferState,
  utterance: string,
): PhoneIngestResult {
  const text = utterance.trim();
  if (!text) {
    return {
      state,
      kind: 'empty',
      systemNote: buildPhoneProtocolSystemNote(state, 'empty'),
    };
  }

  if (isPhoneConfirmCue(text) && state.digits.length === 10 && INDIAN_MOBILE_RE.test(state.digits)) {
    return {
      state,
      kind: 'confirm_ready',
      systemNote: buildPhoneProtocolSystemNote(state, 'confirm_ready'),
    };
  }

  if (isPhoneRejectCue(text) && !normalizeSpokenPhone(text)) {
    const cleared = { digits: '', failedAttempts: state.failedAttempts + 1 };
    return {
      state: cleared,
      kind: cleared.failedAttempts >= 3 ? 'escalate' : 'empty',
      systemNote: buildPhoneProtocolSystemNote(cleared, cleared.failedAttempts >= 3 ? 'escalate' : 'empty'),
    };
  }

  const patch = detectLeadingDigitPatch(text);
  if (patch && state.digits) {
    let digits = state.digits;
    if (!digits.startsWith(patch)) {
      digits = (patch + digits).slice(0, 12);
    }
    const classified = classifyLength(digits);
    const nextState = { digits: classified.digits, failedAttempts: state.failedAttempts };
    return {
      state: nextState,
      kind: classified.kind === 'complete' ? 'complete' : classified.kind,
      systemNote: buildPhoneProtocolSystemNote(nextState, classified.kind === 'complete' ? 'complete' : 'partial'),
    };
  }

  const incoming = normalizeSpokenPhone(text);
  if (!incoming) {
    // Letters / garbage while capturing — keep buffer, nudge remaining
    const kind = state.digits ? 'partial' : 'letters';
    const failedAttempts = state.digits ? state.failedAttempts : state.failedAttempts + 1;
    const nextState = { digits: state.digits, failedAttempts };
    const escalate = failedAttempts >= 3 && !state.digits;
    return {
      state: nextState,
      kind: escalate ? 'escalate' : kind,
      systemNote: buildPhoneProtocolSystemNote(
        nextState,
        escalate ? 'escalate' : kind,
      ),
    };
  }

  const merged = mergePhoneDigits(state.digits, incoming);
  let failedAttempts = state.failedAttempts;
  if (merged.kind === 'conflict' || merged.kind === 'too_long') {
    failedAttempts += 1;
  }
  const nextState: PhoneBufferState = {
    digits: merged.digits,
    failedAttempts,
  };
  const kind: PhoneIngestKind =
    failedAttempts >= 3 && (merged.kind === 'conflict' || merged.kind === 'too_long')
      ? 'escalate'
      : merged.kind;

  return {
    state: nextState,
    kind,
    conflictWith: merged.conflictWith,
    systemNote: buildPhoneProtocolSystemNote(nextState, kind, merged.conflictWith),
  };
}

/** System note injected onto the user turn for the LLM (stripped from transcripts). */
export function buildPhoneProtocolSystemNote(
  state: PhoneBufferState,
  kind: PhoneIngestKind,
  conflictWith?: string,
): string {
  const buf = state.digits || '(none)';
  const spoken = spokenBuffer(state.digits);
  const remain = remainingCount(state.digits);
  const readBack =
    state.digits.length === 10 && INDIAN_MOBILE_RE.test(state.digits)
      ? formatPhoneForSpeech(state.digits, 'en')
      : spoken;

  const base =
    `[System: PHONE PROTOCOL — Indian sales notepad. BUFFER=${buf} (${state.digits.length}/10, spoken: ${spoken}). ` +
    `Reply in call language (Roman Hinglish if Hinglish call) — NEVER flip to full English mid-call just because digits failed. ` +
    `Digit read-back uses English digit words only. NEVER invent/add/remove digits to force length 10. ` +
    `NEVER default to "please say the full 10-digit number" / "I'm still not getting…" when BUFFER has digits — ack what you have, ask only for the rest.]`;

  switch (kind) {
    case 'partial':
      return (
        `${base} ACTION: Ack heard digits in English words ("${spoken}"), then ask ONLY for the remaining ${remain} digit(s) — e.g. "Theek hai — ${spoken} sun liya. Aage ke ${remain} digits boliye." Do NOT wipe the notepad.`
      );
    case 'complete':
    case 'confirm_ready':
      return (
        `${base} ACTION: Read back in pairs: "${readBack}" — then "Yeh number sahi hai?" Wait for haan/yes before phone_confirmed / save.`
      );
    case 'too_long':
      return (
        `${base} ACTION: Buffer has ${state.digits.length} digits (too many). Do NOT invent a fix. Say line unclear — ask which 10 digits are correct, or confirm by reading candidate groups. Do not save.`
      );
    case 'conflict':
      return (
        `${base} ACTION: Conflict — notepad has ${spoken}` +
        (conflictWith
          ? `, new number sounds like ${digitsToWords(conflictWith, 'en')}`
          : '') +
        `. Ask "Pehle wala ya naya?" — do not silently switch. Do not save.`
      );
    case 'escalate':
      return (
        `${base} ACTION: After repeated fails, escalate softly in Hinglish — offer WhatsApp/SMS number or dealer callback. Do NOT keep the same full-reset loop.`
      );
    case 'letters':
      return (
        `${base} ACTION: No clear digits this turn. Soft ask for mobile digits only (Hinglish). Blame the line, not the caller.`
      );
    case 'empty':
    case 'idle':
    default:
      return (
        `${base} ACTION: If asking first time: "Mobile number bata dijiye." If BUFFER has digits, continue notepad style (ack + remaining).`
      );
  }
}

/** Caller noticed name was skipped after booking flow. */
export function looksLikeNameMissComplaint(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/नाम/.test(t) && /(नहीं|नही|पूछ|पुछ)/.test(t)) return true;
  return (
    /\bnaam\b/i.test(t) &&
    /\b(pooch|puch|nahi|nahin|miss|bhool|bhul|ask|asked)\b/i.test(t)
  ) || /\b(aapne\s+naam|name\s+nahi|didn't\s+ask\s+(my\s+)?name|forgot\s+(my\s+)?name)\b/i.test(t);
}

export function buildNameRecoverySystemNote(): string {
  return (
    '[System: NAME RECOVERY — caller said name was not asked / missed. Immediately apologize briefly in the call language (Hinglish if Hinglish call). ' +
    'Ask full name NOW, read back ("Maine suna {name} — yeh sahi hai?"), get haan. ' +
    'If booking already saved, confirm name then call update_demo_lead_name. ' +
    'Do NOT pivot to car/model Q&A until name is handled.]'
  );
}
