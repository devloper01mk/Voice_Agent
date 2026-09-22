/**
 * Fast half-duplex helpers: when to start LLM on interim STT,
 * and how to cut LLM tokens into speakable chunks.
 */

import {
  isDirectQuestionToAgent,
  isGoAheadCue,
  isUrgentBargeInCue,
  shouldBargeInOnSpeech,
  shouldSuppressAgentReply,
} from './call-patience.js';

export const SPECULATIVE_STABLE_MS = 250;
export const HOLD_ACK_AFTER_MS = 600;
/** Kept for callers; first audio now waits for a sentence boundary, not a word count. */
export const FIRST_CHUNK_MIN_WORDS = 12;

export function normalizeHeard(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,!?'"।]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Start LLM before Azure final — short acks / go-ahead / exploring stay out. */
export function shouldSpeculateOnInterim(text: string): boolean {
  const t = text.normalize('NFC').trim();
  if (!t) return false;
  if (shouldSuppressAgentReply(t)) return false;
  if (isGoAheadCue(t)) return false;
  if (/^(?:ruko|ruk\s*jao|ruk\s*jaa?|stop|wait|chup(?:\s*ho)?|be\s*quiet|रुक(?:ो| जाओ?)?|चुप)\s*[.!?]*$/i.test(t)) {
    return false;
  }
  if (isUrgentBargeInCue(t) || isDirectQuestionToAgent(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 3 && shouldBargeInOnSpeech(t);
}

/** Interim vs final — same ask, or final only added a few words. */
export function speculativeHeardMatch(interim: string, finalHeard: string): boolean {
  const a = normalizeHeard(interim);
  const b = normalizeHeard(finalHeard);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.startsWith(a) || a.startsWith(b)) {
    const extra = Math.abs(a.split(/\s+/).length - b.split(/\s+/).length);
    return extra <= 3;
  }
  return false;
}

function isDecimalDot(content: string, dotIdx: number): boolean {
  return (
    content[dotIdx] === '.' &&
    /\d/.test(content[dotIdx - 1] ?? '') &&
    /\d/.test(content[dotIdx + 1] ?? '')
  );
}

/** Digit + "." — wait for the next token, or skip if the next real char is a digit (1.\\n0L). */
function shouldHoldNumericDot(content: string, dotIdx: number, end: boolean): boolean {
  if (content[dotIdx] !== '.') return false;
  if (!/\d/.test(content[dotIdx - 1] ?? '')) return false;
  let j = dotIdx - 1;
  while (j >= 0 && /\d/.test(content[j]!)) j -= 1;
  const prev = content[j];
  if (prev !== undefined && /[A-Za-z\u0900-\u097F]/.test(prev)) return false;
  const after = content.slice(dotIdx + 1);
  const next = after.match(/^\s*(.)/);
  if (!next) return !end;
  return /\d/.test(next[1]);
}

/**
 * Pull newly speakable chunks from an accumulating LLM buffer.
 * Only split on sentence end (. ? ! ।) so TTS never starts mid-word.
 */
export function extractNewSpokenChunks(
  content: string,
  cursor: number,
  end: boolean,
): { chunks: string[]; cursor: number } {
  const chunks: string[] = [];
  let i = cursor;
  if (i < 0) i = 0;
  if (i > content.length) i = content.length;

  const re = /[.?!।](?:\s+|$)/g;
  re.lastIndex = i;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    if (isDecimalDot(content, match.index) || shouldHoldNumericDot(content, match.index, end)) {
      continue;
    }
    const endIdx = match.index + match[0].length;
    const chunk = content.slice(i, endIdx).trim();
    if (chunk) chunks.push(chunk);
    i = endIdx;
  }

  if (end) {
    const tail = content.slice(i).trim();
    if (tail) {
      chunks.push(tail);
      i = content.length;
    }
  }

  return { chunks, cursor: i };
}
