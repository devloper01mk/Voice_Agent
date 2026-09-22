/**
 * Detect caller exploring / thinking turns so the agent stays quiet
 * until a direct question (product-agnostic — multi-product safe).
 */

import { isLikelyProductOrSalesTurn } from './off-topic-wrap.js';

const EXPLORING_CUE =
  /\b(hmm+|hmmm+|umm+|uh+\b|ach+ha+\s+ach+ha+|accha+\s+accha+|haan\s+haan|aise\s+hai\s+na|dekhta\s+hoon|dekhti\s+hoon|dekh\s+raha|dekh\s+rahi|dekh\s+lete|sochta\s+hoon|sochti\s+hoon|soch\s+raha|soch\s+rahi|ek\s+(?:min(?:ute)?\s+)?dekhta?\s*hoon?)\b/i;

const DIRECT_QUESTION =
  /\?|\b(kya|kitna|kitni|kaun|kab|kahan|kahaan|kaise|kyun|kyu|how|what|which|when|where|why|tell\s+me|can\s+you|could\s+you|batao|bataiye|batana|boliye|bolo|suniye|sunao)\b/i;

const PRODUCT_ASK =
  /\b(price|pricing|emi|demo|test\s*drive|features?|mileage|compare|difference|on[- ]?road|variant|model|booking)\b|कीमत|प्राइस|फीचर|माइलेज/i;

/** Caller telling the agent to stop talking (Latin + Devanagari). */
const STOP_SPEAKING =
  /^(?:ruko|ruk\s*jao|ruk\s*jaa?|stop|wait|chup(?:\s*ho)?|be\s*quiet|suniye|suno|arey|arre|arrey)\s*[.!?]*$|^(?:रुक(?:ो| जाओ?)?|चुप|सुनिए|सुनो|अरे)\s*[.!?]*$/i;

/** Mid-speech interruption — caller correcting language or cutting in. */
const INTERRUPTION_CUE =
  /\b(arey|arre|arrey|suniye|suno|listen|nahi|nahin|galat|wrong|english\s+mein|hindi\s+mein|hinglish\s+mein)\b|अरे|सुनिए|सुनो|नहीं|गलत|हिंदी\s*में|इंग्लिश\s*में/i;

/** Short backchannels / acks — mute so barge-in does not restart the agent reply. */
const MUTTERING_ONLY =
  /^(hmm+|hmmm+|umm+|uh+|achch?a+|accha+|haan+(\s*ji)?|ji+|ok+|okay+|yes+|yeah+|yep+|theek(\s*hai)?|thik(\s*hai)?|सही(\s*है)?|ठीक(\s*है)?|हाँ+(\s*जी)?|हां+(\s*जी)?|जी+|sahi(\s*hai)?|bilkul|hmm+\s*ji|ma'?am+|madam+|mam+|sir+)(\s+(hmm+|hmmm+|umm+|uh+|ji+|ok+|okay+|yes+|haan+|ma'?am+|madam+|mam+|sir+|जी+))*\s*[.!?।]*$/i;

import { isClearBusyOrCallbackTurn } from './call-busy.js';

/** Clear refusal — not “X chahiye”, not a booking confirm. */
const CLEAR_REFUSAL =
  /\b(not\s+interested|no\s+(?:need|thanks)|don'?t\s+want(?:\s+it)?|do\s+not\s+want|nahi+\s+chahiye|nahin\s+chahiye|nahi+\s+lena|mat\s+call|don'?t\s+call)\b|नहीं\s*चाहिए|मत\s*(?:कॉल|करो)/i;

/** Lead time / when-can-I-get-it — not a price recap. Product-agnostic. */
const AVAILABILITY_TIMELINE =
  /\b(wait(?:ing)?(?:\s*time)?|lead[\s-]*time|deliver(?:y|ed)|availability|in[\s-]*stock|out\s+of\s+stock|when\s+(?:will|can)\s+(?:i|we|it)\s+(?:get|arrive|start)|kitn[ei]\s+(?:der|din|time|wait)|kab\s+(?:milega|milenge|aayega|hoga)|update\s+kitn)\b|वेटिंग|डिलीवरी|उपलब्ध|कितनी\s+(?:देर|दिन)|कब\s+(?:मिलेगा|आएगा)|अपडेट\s+कितन/i;

/** Caller asking for more value — not a recap of prices already spoken. */
const TELL_ME_MORE =
  /\b(?:aur\s+(?:bata(?:o|iye|na)|suna(?:o|iye)|bolo)|tell\s+me\s+more|and\s+tell\s+me)\b|और\s+(?:बता(?:ओ|इए|इये|ना)?|सुना(?:ओ|इए)?)/i;

/** Caller asking the agent to speak / continue (Latin + Devanagari). */
const GO_AHEAD_ACK =
  '(?:ji|जी|haan+|han+|haaji|haanji|yes|हाँ+|हां+)\\s*[,.]?\\s*';
const GO_AHEAD_SPEAK =
  '(?:boliye|bolie|bolo|बोलिए|बोलो|सुनिए|सुनो|batao|bataiye|batayiye|बताओ|बताइए|बताइये)(?:\\s+(?:na|ना))?';
const GO_AHEAD_EN =
  '(?:please\\s+)?(?:continue|go\\s+ahead|speak|tell\\s+me)(?:\\s+please)?';
const GO_AHEAD_HONORIFIC =
  "(?:\\s+(?:ma'?am+|mam+|madam+|sir+|माम्|मैम))?";
const GO_AHEAD_ONLY = new RegExp(
  `^(?:(?:${GO_AHEAD_ACK})*(?:${GO_AHEAD_SPEAK}|${GO_AHEAD_EN})|${GO_AHEAD_EN})` +
    `(?:[,.]?\\s+(?:may\\s+i(?:\\s+please)?|please(?:\\s+do)?|please\\s+speak))?` +
    `${GO_AHEAD_HONORIFIC}\\s*[.!?।]*$`,
  'i',
);

/** Bare yes/haan (+ optional ji / sir / ma'am) — permission grant after time-ask opener. */
const GO_AHEAD_SHORT_YES =
  /^(?:yes|yeah|yep|sure|haan+|han+|हाँ+|हां+)(?:\s*[,.]?\s*(?:ji|जी|ma'?am+|mam+|madam+|sir+|माम्|मैम))*\s*[.!?।]*$/i;

/** Permission grant cue embedded in a longer snowballed STT utterance. */
const PERMISSION_GRANT_SNIPPET =
  /(?:^|[\s,.!?])(haan|han|yes|yeah|haanji|हाँ|हां|मिलेगा|milenge|milega|boliye|bolo|बोलिए|बोलो|बताइए|bataiye|batao)(?:[\s,.!?]|$)|haan\s+ji|tell\s+me|go\s+ahead|mil\s+sakta/i;

/** Last assistant turn asked for a short chat / permission to continue. */
const PERMISSION_ASK =
  /\b(do\s+minute|minute\s+milenge|milenge\b|ek\s+minute|thod[ei]\s+der|thode\s+der|baat\s+kar\s+(?:sakte|saku|sakti|sakta)|got\s+a\s+(?:minute|sec|second)|have\s+a\s+(?:minute|moment|sec)|quick\s+(?:minute|sec|second)|may\s+i\s+(?:have|take)\s+a\s+(?:minute|moment))\b/i;

/** Bare polite closing cues (not a new question). */
const POLITE_END_ONLY =
  /^(thank\s*you|thanks|thx|धन्यवाद|शुक्रिया|shukriya|dhanyava[aā]d|thanks?\s*(ji|a?\s*lot)?|thank\s*you\s*(so\s*much|ji)?|bye+|goodbye|alvida|khuda\s*hafiz|allah\s*hafiz)\s*[.!?]*$/i;

/** Trailing connectors / openers that usually mean the sentence was cut. */
const TRUNCATION_TRAIL =
  /(?:^|[\s,])(phir|toh|to|aur|aapko|aapke|lekin|kyunki|kyumki|because|so|and|or|then|but|for|with|that|jo|agar|if|when|while|plus)\s*[,…]*\s*$/i;

/** Caller hangers — mid-sentence Azure finals in Hinglish. */
const USER_TRUNCATION_TRAIL =
  /(?:^|[\s,])(phir|toh|to|aur|aapko|aapke|lekin|kyunki|kyumki|because|so|and|or|then|but|for|with|that|jo|agar|if|when|while|plus|matlab|yani|ki|ke|ka)\s*[,…]*\s*$/i;

/** Clipped question starters — isDirectQuestionToAgent is true, but the sentence is not done. */
const CLIPPED_ASK_ONLY =
  /^(kya|kitna|kitni|kaun|kab|kahan|kahaan|kaise|kyun|kyu|how|what|which|when|where|why|matlab)[.!?।]*$/i;

/** Hindi hangers — Azure often sticks । on a fragment like "मैंने।" */
const HINDI_TRUNCATION_TRAIL =
  /(?:^|[\s,])(मैंने|मैं|मुझे|उसे|उसी|तो|अगर|कि|के|का|की|को|में|से|और|या|वो|यह|ये)\s*$/u;

/** Extra quiet after Azure already endpointed — keep short so the agent does not feel stuck. */
export const USER_TURN_INCOMPLETE_DELAY_MS = 650;
export const USER_TURN_COMPLETE_DELAY_MS = 280;
export const USER_TURN_DEFAULT_DELAY_MS = 380;
export const USER_TURN_COMMIT_CAP_MS = 900;
/** Same breath after a premature final — still one utterance, not a new topic. */
export const USER_TURN_SAME_BREATH_MS = 700;

function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

const LOOKING_AT =
  /\b(dekh\s+rah[ai]|looking\s+at|considering|interested\s+in)\b|देख\s+रह[ाई]/i;

/** Words that do not count as “what they are looking at”. */
const LOOKING_FILLER =
  /^(hmm+|hmmm+|umm+|uh+|haan+|han+|ji+|ok+|okay+|theek|thik|hai|hoon|hun|tha|thi|the|a|i|am|was|mein|main|mai|me|dekh|raha|rahi|looking|at|soch|sochta|sochti|ek|min|minute|can)$/i;

/**
 * “SUV dekh raha tha” / “looking at the compact one” — stating interest, not hmm-thinking.
 * Product-agnostic: any extra content besides looking-verbs + filler.
 */
export function isStatingConsiderationTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (!LOOKING_AT.test(t)) return false;
  const content = t
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z\u0900-\u097F]+/g, ''))
    .filter((w) => w.length > 0 && !LOOKING_FILLER.test(w));
  return content.length >= 1;
}

/** Caller is thinking aloud or exploring — not asking the agent yet. */
export function isExploringOrThinkingTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (isStatingConsiderationTurn(t)) return false;

  if (EXPLORING_CUE.test(t)) return true;
  if (MUTTERING_ONLY.test(t)) return true;

  const words = t.split(/\s+/).length;
  if (words <= 8 && /\b(dekho|dekhte|dekhti)\b/i.test(t) && !/\?/.test(t) && !DIRECT_QUESTION.test(t)) {
    return true;
  }

  return false;
}

/** Caller asked to hear more — one new benefit, not a price recap. */
export function isTellMeMoreTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return TELL_ME_MORE.test(t);
}

/** Clear question directed at the agent — should get a reply. */
export function isDirectQuestionToAgent(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;

  if (/\baise\s+hai\s+na\b/i.test(t) && !/\?/.test(t) && !isLikelyProductOrSalesTurn(t)) {
    return false;
  }

  if (isTellMeMoreTurn(t)) return true;
  if (isGoAheadCue(t)) return true;
  if (/\?/.test(t)) return true;
  if (/\b(batao|bataiye|batana|boliye|suniye|sunao)\b/i.test(t)) return true;
  if (/\b(what|how\s+much|how\s+many|which|when|where|why)\b/i.test(t)) return true;
  if (DIRECT_QUESTION.test(t)) return true;
  if (PRODUCT_ASK.test(t)) return true;

  return false;
}

/**
 * While the agent is speaking: cut TTS only for stop cues, product asks,
 * and clear questions. Two-word fragments and "jaanna hai" were chopping
 * answers; those wait until playback ends.
 */
export function shouldBargeInOnSpeech(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (MUTTERING_ONLY.test(t)) return false;
  if (STOP_SPEAKING.test(t)) return true;
  if (PRODUCT_ASK.test(t)) return true;
  if (isUrgentBargeInCue(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (INTERRUPTION_CUE.test(t) && words.length >= 2) return true;
  return words.length >= 4 && isDirectQuestionToAgent(t);
}

/** 1-word product asks, stop cues, and clear questions — cut TTS without extra delay. */
export function isUrgentBargeInCue(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (MUTTERING_ONLY.test(t)) return false;
  if (STOP_SPEAKING.test(t)) return true;
  if (PRODUCT_ASK.test(t)) return true;
  if (/\?/.test(t)) return true;
  if (/\b(kya|kitna|kitni|batao|bataiye|boliye|how|what|which|when|where|why)\b/i.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (INTERRUPTION_CUE.test(t) && words.length >= 2) return true;
  if (/\b(arey|arre|arrey)\b/i.test(t) && words.length >= 2) return true;
  if (/\b(suniye|suno|listen)\b/i.test(t)) return true;
  return false;
}

/** True when runtime should mute the agent for this user turn. */
export function shouldSuppressAgentReply(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (isDirectQuestionToAgent(t)) return false;
  if (isPoliteEndCue(t)) return false;
  if (isStatingConsiderationTurn(t)) return false;
  if (isAvailabilityTimelineTurn(t)) return false;
  if (isTellMeMoreTurn(t)) return false;
  if (isLikelyProductOrSalesTurn(t) && !MUTTERING_ONLY.test(t)) return false;
  return isExploringOrThinkingTurn(t);
}

/** Short “please speak / go ahead” — not a new product question. */
export function isGoAheadCue(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (t.split(/\s+/).length > 10) return false;
  return GO_AHEAD_ONLY.test(t);
}

/**
 * Permission grant after time-ask opener: speak verbs OR bare yes/haan (+ sir/ma'am).
 * Bare yes/haan alone stay backchannels mid-call — only pair with looksLikePermissionAsk.
 */
export function isPermissionGrantCue(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (t.split(/\s+/).length > 10) return false;
  return GO_AHEAD_ONLY.test(t) || GO_AHEAD_SHORT_YES.test(t);
}

/**
 * Detect permission grant even inside long snowballed STT (e.g. "haan milega but call kahan se").
 * Requires the last assistant turn to have asked for time.
 */
export function isPermissionGrantedTurn(text: string, lastAssistantText: string): boolean {
  if (!looksLikePermissionAsk(lastAssistantText)) return false;
  if (isPermissionGrantCue(text)) return true;
  const t = normalizeTurn(text);
  if (!t || isClearRefusalTurn(t)) return false;
  return PERMISSION_GRANT_SNIPPET.test(t);
}

/** Assistant just asked for a minute / permission (outbound opener). */
export function looksLikePermissionAsk(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return PERMISSION_ASK.test(t);
}

/** Bare thank-you / closing — wrap politely, do not restart pitch. */
export function isPoliteEndCue(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return POLITE_END_ONLY.test(t);
}

/**
 * Last assistant playout looks cut mid-sentence (barge-in hard-cut remnant).
 * Heuristic: trailing connector, hanging comma/ellipsis, or very short incomplete turn.
 */
export function looksTruncatedAssistantTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;

  // Strip trailing punctuation except ellipsis / comma (kept for hang detection).
  const endsWithTerminal = /[.!?।]$/.test(t);
  if (endsWithTerminal) return false;

  if (/[,…]\s*$/.test(t)) return true;
  if (TRUNCATION_TRAIL.test(t)) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 5 && !endsWithTerminal) {
    // Short fragments like "Perfect, phir" / "Aapko"
    if (TRUNCATION_TRAIL.test(t) || /,\s*\S+\s*$/.test(t)) return true;
    if (words.length <= 2) return true;
  }

  return false;
}

/**
 * Azure/VAD closed the user turn too early — hanging connectors or a clipped "kya"/"how".
 * Trailing । / . is ignored: Hindi STT often punctuates a fragment ("हैलो, मैंने।").
 */
export function looksIncompleteUserTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  const stripped = t.replace(/[.!?।]+$/g, '').trim();
  if (!stripped) return false;
  if (CLIPPED_ASK_ONLY.test(stripped)) return true;
  if (/[,…]\s*$/.test(t) || /[,…]\s*$/.test(stripped)) return true;
  if (USER_TRUNCATION_TRAIL.test(stripped)) return true;
  if (HINDI_TRUNCATION_TRAIL.test(stripped)) return true;
  return false;
}

/** Quiet time after last STT (not line energy) before committing the caller turn. */
export function userTurnCommitDelayMs(text: string): number {
  const t = normalizeTurn(text);
  if (!t) return USER_TURN_DEFAULT_DELAY_MS;
  if (looksIncompleteUserTurn(t)) return USER_TURN_INCOMPLETE_DELAY_MS;
  if (isPoliteEndCue(t) || isGoAheadCue(t)) return USER_TURN_COMPLETE_DELAY_MS;
  const words = t.split(/\s+/).filter(Boolean);
  const stripped = t.replace(/[.!?।]+$/g, '').trim();
  if (words.length >= 5 && !looksIncompleteUserTurn(stripped)) return USER_TURN_COMPLETE_DELAY_MS;
  if (isDirectQuestionToAgent(t) && words.length >= 3) return USER_TURN_COMPLETE_DELAY_MS;
  return USER_TURN_DEFAULT_DELAY_MS;
}

/** Commit when STT has been quiet for the adaptive delay, capped so we never stall. */
export function shouldCommitUserTurn(opts: {
  text: string;
  now: number;
  lastSttAt: number;
  /** Ignored — Acefone line energy must not stretch the wait after the caller stopped. */
  lastVoicedAt?: number;
}): boolean {
  const t = opts.text.trim();
  if (!t) return false;
  const quietMs = opts.now - opts.lastSttAt;
  if (quietMs >= USER_TURN_COMMIT_CAP_MS) return true;
  return quietMs >= userTurnCommitDelayMs(t);
}

/** Injected when caller says go-ahead after a complete ask (not a mid-sentence cut). */
export function buildGoAheadDiscoverySystemNote(): string {
  return (
    '[SYSTEM: Caller granted time (yes / haan / boliye / bataiye / tell me) after you asked for permission. ' +
    'You already introduced yourself this call — do NOT say your name or company again. ' +
    'Do NOT restate the enquiry/opener pitch. Do NOT re-ask "thodi der baat kar sakti/sakta hoon" or "do minute milenge?". ' +
    'Do NOT switch to English just because they said "yes" / "yes sir" — stay sticky call language (Hinglish if the call was Hinglish). ' +
    'Do NOT dump models, prices, variants, or feature lists. ' +
    'Ask ONE short discovery question from Product Knowledge (what they need, which offering) in 1 sentence, then STOP and wait. ' +
    'No catalog recap. No second question.]'
  );
}

/** Injected when caller says go-ahead after a mid-sentence barge-in cut. */
export function buildContinueInterruptedSystemNote(truncatedText: string): string {
  const snippet = normalizeTurn(truncatedText).slice(0, 120);
  return (
    `[SYSTEM: Your previous reply was cut mid-sentence (caller heard roughly: "${snippet}"). ` +
    `Caller said go-ahead / please continue. Seamlessly finish that incomplete thought in 1–2 short spoken sentences. ` +
    `Do NOT restart greeting, discovery, or re-open with the same lead-in (e.g. "Perfect…"). Pick up where you left off.]`
  );
}

/** True when the caller clearly does not want to proceed. */
export function isClearRefusalTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (isClearBusyOrCallbackTurn(t)) return false;
  return CLEAR_REFUSAL.test(t);
}

/** Waiting / delivery / when-available — answer from Product Knowledge, not a price recap. */
export function isAvailabilityTimelineTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (isClearRefusalTurn(t)) return false;
  return AVAILABILITY_TIMELINE.test(t);
}

export function buildAvailabilityTimelineSystemNote(): string {
  return (
    '[SYSTEM: Caller asked about waiting / delivery / availability / when they can get it. ' +
    'Answer only from Product Knowledge (or say the confirmed figure is not in Product Knowledge). ' +
    'Do NOT recap prices, plans, or specs already spoken this call. Do NOT invent a booking time or say a slot is noted.]'
  );
}

export function buildRefusalCloseSystemNote(bookingSaved = false): string {
  if (bookingSaved) {
    return (
      '[SYSTEM: Caller is refusing / not interested AFTER a booking was actually saved this call. ' +
      'Acknowledge the refusal. Do not pitch. If they want to cancel, say you will note the cancel — do not invent a new time. Then end_call.]'
    );
  }
  return (
    '[SYSTEM: Caller clearly refused (not interested / nahi chahiye) — possibly with thank-you. ' +
    'This is NOT a booking. Warm one-sentence close. ' +
    'NEVER invent, note, or restate an appointment / slot / demo time. NEVER say booked or noted. Then end_call.]'
  );
}

/** Injected when caller gives a bare thank-you / closing cue. */
export function buildPoliteEndSystemNote(bookingSaved = false): string {
  const slot = bookingSaved
    ? 'A booking WAS saved this call — you may restate that saved time only, never a new time. '
    : 'NO booking was saved this call — do NOT mention, invent, or “note” any slot/time/appointment. ';
  return (
    `[SYSTEM: Caller said a polite thank-you / closing cue. ${slot}` +
    `Wrap up warmly in one short sentence — do not restart the pitch or ask a new discovery question. ` +
    `Then call end_call so the phone hangs up after you finish speaking.]`
  );
}

/** Caller cut the agent with a new ask — do not finish the previous spoken list. */
export function buildInterruptedNewQuestionNote(): string {
  return (
    '[SYSTEM: Caller interrupted you. Stay silent on the previous reply — do not finish, recap, or resume that list. ' +
    'Listen to what they just said and answer only that. Salesperson rule: stop, listen, then answer the new question.]'
  );
}

/** Caller asked for more — new value + next step, never a recap. */
export function buildTellMeMoreSystemNote(): string {
  return (
    '[SYSTEM: Caller asked you to tell them more. Do NOT repeat prices, variants, or facts you already said this call. ' +
    'Give ONE new benefit from Product Knowledge in 1–2 sentences, then offer the next step listed there (demo / visit / trial). ' +
    'Never recap the same comparison if already spoken. Never end_call.]'
  );
}
