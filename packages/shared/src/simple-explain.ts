/**
 * Product-agnostic sales+support: when the caller is confused or asks for
 * simple language, explain Product Knowledge in everyday words.
 * No feature/model dictionaries — the LLM infers meaning from Brain.
 */

function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Caller wants everyday language, not a catalog dump. */
const SIMPLE_EXPLAIN_REQUEST =
  /(?:\b(?:simple|seedha|seeda|normal|easy|aasan|asan)\b.{0,28}\b(?:language|bhasha|bhaasha|tarike|tareeke|words?|mein|me)\b|\b(?:language|bhasha)\b.{0,20}\b(?:simple|seedha|normal|easy)\b|\bspeak\s+simply\b|\bin\s+simple\s+words\b|\bthrough\s+the\s+normal\b|\bsay\s+through\s+the\s+normal\b|\bsamajh\s+nahi[n]?\b|\bdidn'?t\s+understand\b|\blanguage\s+(?:nahi|not)\s+samajh\b|\bknowledge\s+nahi[n]?\b|\bnolej\s+nahi[n]?\b|\bclear\s+nahi[n]?\b|\bexplain\s+(?:simply|please)\b)|नॉर्मल\s*लैंग्वेज|नॉलेज\s*नहीं|समझ\s*नहीं|सीधी\s*(?:बात|भाषा)|आसान\s*(?:भाषा|तरिक)|लैंग्वेज.{0,24}समझ/i;

/** Caller wants the previous explanation continued, not a new intro. */
const CONTINUE_LAST_TOPIC =
  /\b(?:aap\s+to\s+baat\s+bata|bata\s+rahe\s+the|you\s+were\s+(?:telling|saying|explaining)|continue\s+(?:please|that)|pehli\s+wali\s+baat)\b|बात\s*बता\s*रहे\s*थे|आप\s*तो\s*बात/i;

export const SIMPLE_EXPLAIN_STICKY_TURNS = 2;

export function isSimpleExplainRequest(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return SIMPLE_EXPLAIN_REQUEST.test(t);
}

export function isContinueLastTopicRequest(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return CONTINUE_LAST_TOPIC.test(t);
}

export function shouldNudgeSimpleExplain(text: string): boolean {
  return isSimpleExplainRequest(text) || isContinueLastTopicRequest(text);
}

export function buildSimpleExplainSystemNote(): string {
  return (
    '[SYSTEM: Caller needs a simpler explanation. Stay a sales/support advisor. ' +
    'Use Product Knowledge only. Do not invent or change numbers/specs. ' +
    'Explain in everyday language what it means for the caller — do not recite catalog labels. ' +
    'Never speak dotted digits (1.0) or "point/dashamlav"; use words ("ek litre engine"). ' +
    'If they are stuck on a number you already said, one meaning then STOP. ' +
    '2–3 short sentences. Continue the last topic. No new intake, budget, or booking question.]'
  );
}

/** Compact + classic skill text. Must stay product-agnostic (no model/feature names). */
export function simpleExplainSkillLine(): string {
  return (
    'SIMPLE EXPLAIN (sales+support): If the caller is confused or asks for simple/normal/seedha language, ' +
    'explain the last Product Knowledge point in 2–3 everyday sentences. Teach meaning for the caller — ' +
    'do not recite catalog labels. Never invent or change numbers/specs. ' +
    'No new intake/budget/booking question on that turn. Continue the last topic; do not restart the intro. ' +
    'Same rule in SUPPORT: answer from Product Knowledge simply; do not troubleshoot beyond it.'
  );
}
