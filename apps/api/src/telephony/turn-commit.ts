import {
  isDirectQuestionToAgent,
  isGoAheadCue,
  isPoliteEndCue,
  looksIncompleteUserTurn,
} from '@vsa/shared';
import type { TelephonyLatencyTuning } from './latency-profile.js';

function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function telephonyCommitDelayMs(text: string, tuning: TelephonyLatencyTuning): number {
  const t = normalizeTurn(text);
  if (!t) return tuning.commitDefaultMs;
  if (looksIncompleteUserTurn(t)) return tuning.commitIncompleteMs;
  if (isPoliteEndCue(t) || isGoAheadCue(t)) return tuning.commitCompleteMs;
  const words = t.split(/\s+/).filter(Boolean);
  const stripped = t.replace(/[.!?।]+$/g, '').trim();
  if (words.length >= 5 && !looksIncompleteUserTurn(stripped)) return tuning.commitCompleteMs;
  if (isDirectQuestionToAgent(t) && words.length >= 3) return tuning.commitCompleteMs;
  return tuning.commitDefaultMs;
}

export function shouldTelephonyCommitUserTurn(opts: {
  text: string;
  now: number;
  lastSttAt: number;
  tuning: TelephonyLatencyTuning;
}): boolean {
  const t = opts.text.trim();
  if (!t) return false;
  const quietMs = opts.now - opts.lastSttAt;
  if (quietMs >= opts.tuning.commitCapMs) return true;
  return quietMs >= telephonyCommitDelayMs(t, opts.tuning);
}
