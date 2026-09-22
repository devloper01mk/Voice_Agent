import { sanitizeSpokenHistoryForLlm } from './strip-system-notes.js';

/**
 * Append-only window so OpenAI prefix cache stays hot. Trim only on very long
 * calls — rewriting the prefix mid-call forces a cache miss.
 */
export const LLM_SPOKEN_HISTORY_KEEP = 40;

export type SpokenHistoryMessage = {
  role: string;
  content?: string;
};

/**
 * Pin the first assistant line (outbound opener), then keep the last `keep` spoken
 * messages. Drop a leading assistant in the tail so the window starts on a user turn.
 */
export function trimSpokenHistoryForLlm<T extends SpokenHistoryMessage>(
  history: T[],
  keep = LLM_SPOKEN_HISTORY_KEEP,
): T[] {
  const cleaned = sanitizeSpokenHistoryForLlm(history);
  if (cleaned.length <= keep) return cleaned;

  const openerIdx = cleaned.findIndex((m) => m.role === 'assistant');
  const opener = openerIdx >= 0 ? cleaned[openerIdx] : undefined;
  const withoutOpener = opener ? cleaned.filter((_, i) => i !== openerIdx) : cleaned;
  let tail = withoutOpener.slice(-keep);
  if (tail[0]?.role === 'assistant') tail = tail.slice(1);
  if (opener && !tail.includes(opener)) return [opener, ...tail];
  return tail;
}
