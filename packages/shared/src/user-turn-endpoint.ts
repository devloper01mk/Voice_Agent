import {
  looksIncompleteUserTurn,
  shouldCommitUserTurn,
  USER_TURN_COMMIT_CAP_MS,
  USER_TURN_COMPLETE_DELAY_MS,
  USER_TURN_DEFAULT_DELAY_MS,
  USER_TURN_INCOMPLETE_DELAY_MS,
  USER_TURN_SAME_BREATH_MS,
  userTurnCommitDelayMs,
} from './call-patience.js';
import { normalizeHeard, speculativeHeardMatch } from './spoken-latency.js';

export {
  looksIncompleteUserTurn,
  shouldCommitUserTurn,
  USER_TURN_COMMIT_CAP_MS,
  USER_TURN_COMPLETE_DELAY_MS,
  USER_TURN_DEFAULT_DELAY_MS,
  USER_TURN_INCOMPLETE_DELAY_MS,
  userTurnCommitDelayMs,
};

/** Join consecutive Azure segments into one caller utterance (finals are often overlapping prefixes). */
export function mergeUserUtterance(prev: string, next: string): string {
  const a = prev.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  const na = normalizeHeard(a);
  const nb = normalizeHeard(b);
  if (!na) return b;
  if (!nb) return a;
  if (na === nb) return b.length >= a.length ? b : a;
  if (nb.startsWith(na)) return b;
  if (na.startsWith(nb)) return a;
  if (na.includes(` ${nb} `) || na.endsWith(` ${nb}`) || na.startsWith(`${nb} `)) return a;
  if (nb.includes(` ${na} `) || nb.endsWith(` ${na}`) || nb.startsWith(`${na} `)) return b;
  return `${a} ${b}`;
}

/**
 * Incoming Azure text is still the same caller utterance (growing prefix / hanging fragment),
 * not a new question that should start a fresh turn.
 */
export function isSameUtteranceContinuation(
  committed: string,
  incoming: string,
  opts?: { msSinceCommit?: number },
): boolean {
  const a = committed.trim();
  const b = incoming.trim();
  if (!a || !b) return false;
  const merged = mergeUserUtterance(a, b);
  const na = normalizeHeard(a);
  const nb = normalizeHeard(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (nb.startsWith(na) || na.startsWith(nb)) return true;
  if (speculativeHeardMatch(a, merged)) return true;
  const ms = opts?.msSinceCommit ?? 0;
  return looksIncompleteUserTurn(a) && ms < USER_TURN_SAME_BREATH_MS;
}

/** Content words (≥3 chars) shared between two STT strings. */
function contentWords(text: string): string[] {
  return normalizeHeard(text)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/**
 * True when incoming is basically the same ask as committed (prefix/subset/high
 * word overlap) — used to stop Sarvam re-firing the same question as a new turn.
 */
export function isNearDuplicateUtterance(
  committed: string,
  incoming: string,
  opts?: { minSharedWords?: number; minRatio?: number },
): boolean {
  const a = committed.trim();
  const b = incoming.trim();
  if (!a || !b) return false;
  const na = normalizeHeard(a);
  const nb = normalizeHeard(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  if (nb.startsWith(na) || na.startsWith(nb)) return true;

  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.length < 2 || wb.length < 2) return false;
  const setA = new Set(wa);
  let shared = 0;
  for (const w of wb) {
    if (setA.has(w)) shared += 1;
  }
  const minShared = opts?.minSharedWords ?? 3;
  const minRatio = opts?.minRatio ?? 0.65;
  const denom = Math.min(wa.length, wb.length);
  return shared >= minShared && shared / denom >= minRatio;
}
