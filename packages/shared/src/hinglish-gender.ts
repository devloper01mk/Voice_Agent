import type { AgentGender } from './skills-types.js';
import { compressTelephonyS2sInstructions } from './gemini-live-config.js';

const HOON = String.raw`(?:hoon|hun|hu|hūn)`;
const GENDER_LOCK_HEADING = '## Hinglish speaker grammar lock';

export function normalizeAgentGender(raw?: string | null): AgentGender {
  return raw === 'male' ? 'male' : 'female';
}

/**
 * Rewrite first-person Hinglish/Hindi verbs to match the agent's gender.
 * Safe for spoken lines: does not change third-person "karta hai" / "chahti hai".
 */
export function lockSpokenHinglishGender(
  text: string,
  gender?: string | null,
): string {
  if (!text) return text;
  return normalizeAgentGender(gender) === 'male' ? toMale(text) : toFemale(text);
}

/** True when spoken/transcribed assistant text used the opposite first-person gender. */
export function spokenUsesWrongHinglishGender(
  text: string,
  gender?: string | null,
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (normalizeAgentGender(gender) === 'male') {
    return (
      new RegExp(String.raw`\b(?:karti|chahti|chahati)\s+${HOON}\b`, 'i').test(t) ||
      /\b(?:karungi|bataungi|chahungi)\b/i.test(t) ||
      /\b(?:bol|bata|kar)\s+r(?:ehi|ahi)\s+(?:hoon|hun|hu)\b/i.test(t) ||
      /\bkar sakti\s+(?:hoon|hun|hu)\b/i.test(t)
    );
  }
  return (
    new RegExp(String.raw`\b(?:karta|karata|chahta|chahata|chaahata|chata|chate|chaate)\s+${HOON}\b`, 'i').test(
      t,
    ) ||
    /\b(?:karunga|bataunga|chahunga|chaahunga|jaunga)\b/i.test(t) ||
    /\b(?:bol|bata|kar)\s+raha\s+(?:hoon|hun|hu)\b/i.test(t) ||
    /\bkar sakta\s+(?:hoon|hun|hu)\b/i.test(t) ||
    /करता\s*(हूँ|हूं|हुँ)/.test(t) ||
    /चाहता\s*(हूँ|हूं|हुँ)/.test(t)
  );
}

export function buildHinglishGenderLockPrompt(gender?: string | null): string {
  if (normalizeAgentGender(gender) === 'male') {
    return `${GENDER_LOCK_HEADING}
You are a **male** speaker. First-person Hinglish MUST be masculine: karta hoon, chahta hoon, bol raha hoon, karunga, kar sakta hoon.
NEVER say karti/chahti hoon, bol rehi/rahi hoon, karungi.`;
  }
  return `${GENDER_LOCK_HEADING}
You are a **female** speaker. First-person Hinglish MUST be feminine: karti hoon, chahti hoon, bol rehi hoon, karungi, kar sakti hoon.
NEVER say karta/chahta/chata hun/hu/hoon, bol raha hoon, karunga.`;
}

export function buildHinglishGenderCorrectionNote(gender?: string | null): string {
  if (normalizeAgentGender(gender) === 'male') {
    return (
      '[SYSTEM: Your previous turn used feminine first-person verbs (karti/chahti hoon). ' +
      'You are male. This turn use karta hoon, chahta hoon, bol raha hoon, karunga. Never karti/chahti.]'
    );
  }
  return (
    '[SYSTEM: Your previous turn used masculine first-person verbs (karta/chahta hun). ' +
    'You are female. This turn use karti hoon, chahti hoon, bol rehi hoon, karungi. Never karta/chahta hun.]'
  );
}

/** Strip a previous lock section, optionally compress, then always append the lock at the end. */
export function appendHinglishGenderLock(
  prompt: string,
  gender?: string | null,
  maxChars?: number,
): string {
  const lock = buildHinglishGenderLockPrompt(gender);
  const stripped = stripGenderLockSection(prompt).trim();
  if (maxChars != null && maxChars > 0) {
    const budget = Math.max(800, maxChars - lock.length - 8);
    const body = compressTelephonyS2sInstructions(stripped, budget);
    return `${body}\n\n${lock}`;
  }
  return `${stripped}\n\n${lock}`;
}

/** Remove only the lock section — sections appended after it (e.g. S2S supplement) must survive. */
function stripGenderLockSection(prompt: string): string {
  let out = prompt;
  for (;;) {
    const idx = out.lastIndexOf(GENDER_LOCK_HEADING);
    if (idx < 0) return out;
    const afterHeading = idx + GENDER_LOCK_HEADING.length;
    const nextRel = out.slice(afterHeading).search(/\n## /);
    const before = out.slice(0, idx).trimEnd();
    const after = nextRel >= 0 ? out.slice(afterHeading + nextRel).trimStart() : '';
    out = after ? `${before}\n\n${after}` : before;
  }
}

function toFemale(text: string): string {
  let t = text;
  t = t.replace(/करता\s*(हूँ|हूं|हुँ)/g, 'करती हूँ');
  t = t.replace(/चाहता\s*(हूँ|हूं|हुँ)/g, 'चाहती हूँ');

  t = replaceAllCi(t, String.raw`\b(?:chahta|chahata|chaahata|chata|chate|chaate|chahte)\s+${HOON}\b`, 'chahti hoon');
  t = replaceAllCi(t, String.raw`\b(?:karta|karata)\s+${HOON}\b`, 'karti hoon');
  t = t.replace(
    /\b((?:check|note|schedule|update|wait|baat)\s+kar|bol|bata|kar|samajh|samjha|dekh|sun)\s+rah[ai]\s+(?:hoon|hun|hu|hūn)\b/gi,
    '$1 rehi hoon',
  );
  t = replaceAllCi(t, String.raw`\bkar sakta\s+${HOON}\b`, 'kar sakti hoon');
  t = replaceAllCi(t, String.raw`\bbol sakta\s+${HOON}\b`, 'bol sakti hoon');
  t = replaceAllCi(t, String.raw`\b(?:karunga|karungaa)\b`, 'karungi');
  t = replaceAllCi(t, String.raw`\bbataunga\b`, 'bataungi');
  t = replaceAllCi(t, String.raw`\b(?:dunga|doonga)\b`, 'dungi');
  t = replaceAllCi(t, String.raw`\bjaunga\b`, 'jaungi');
  t = replaceAllCi(t, String.raw`\b(?:chahunga|chaahunga)\b`, 'chahungi');
  t = replaceAllCi(t, String.raw`\bsakunga\b`, 'sakungi');
  t = t.replace(/\b(main|mein)\s+samajh\s+gaya\b/gi, 'main samajh gayi');
  t = t.replace(/\b(main|mein)\s+kar\s+diya\b/gi, 'main kar di');
  // Chunked TTS: "karta" / "chahta" without hoon, but not third-person "karta hai".
  t = t.replace(/\bkarta\b(?!\s+(?:hai|hain|tha|the))/gi, 'karti');
  t = t.replace(/\b(?:chahta|chahata|chata|chate|chahte)\b(?!\s+(?:hai|hain|tha|the))/gi, 'chahti');
  return t;
}

function toMale(text: string): string {
  let t = text;
  t = t.replace(/करती\s*(हूँ|हूं|हुँ)/g, 'करता हूँ');
  t = t.replace(/चाहती\s*(हूँ|हूं|हुँ)/g, 'चाहता हूँ');

  t = replaceAllCi(t, String.raw`\b(?:karti|karati)\s+${HOON}\b`, 'karta hoon');
  t = replaceAllCi(t, String.raw`\b(?:chahti|chahati)\s+${HOON}\b`, 'chahta hoon');
  t = t.replace(
    /\b((?:check|note|schedule|update|wait|baat)\s+kar|bol|bata|kar|samajh|samjha|dekh|sun)\s+r(?:ehi|ahi)\s+(?:hoon|hun|hu|hūn)\b/gi,
    '$1 raha hoon',
  );
  t = replaceAllCi(t, String.raw`\bkar sakti\s+${HOON}\b`, 'kar sakta hoon');
  t = replaceAllCi(t, String.raw`\bbol sakti\s+${HOON}\b`, 'bol sakta hoon');
  t = replaceAllCi(t, String.raw`\b(?:karungi|karungii)\b`, 'karunga');
  t = replaceAllCi(t, String.raw`\bbataungi\b`, 'bataunga');
  t = replaceAllCi(t, String.raw`\bdungi\b`, 'dunga');
  t = replaceAllCi(t, String.raw`\bjaungi\b`, 'jaunga');
  t = replaceAllCi(t, String.raw`\bchahungi\b`, 'chahunga');
  t = t.replace(/\b(main|mein)\s+samajh\s+gayi\b/gi, 'main samajh gaya');
  t = t.replace(/\b(main|mein)\s+kar\s+di\b/gi, 'main kar diya');
  t = t.replace(/\bkarti\b(?!\s+(?:hai|hain|thi|thin))/gi, 'karta');
  t = t.replace(/\b(?:chahti|chahati)\b(?!\s+(?:hai|hain|thi|thin))/gi, 'chahta');
  return t;
}

function replaceAllCi(text: string, pattern: string, replacement: string): string {
  return text.replace(new RegExp(pattern, 'gi'), replacement);
}
