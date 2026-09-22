/**
 * Lightweight call-scoped feel helpers for Simulator 2.0:
 * track recent soft openers / acks / sales bridges so consecutive turns do not sound identical,
 * and nudge away from back-to-back discovery questions.
 */

/** Soft thinking openers (complex turns only — enforced by prompt). */
export const SOFT_OPENERS = [
  'Hmm…',
  'Hmm.',
  'Dekhta hoon zara.',
  'Dekhti hoon zara.',
  'Ek second…',
  'Ek second.',
  'Theek hai —',
  'Chalo.',
  'Achha —',
  'Okay —',
  'Right —',
  'So —',
] as const;

/** Contextual acknowledgements. */
export const ACKS = [
  'Samajh gaya',
  'Samajh gayi',
  'Theek hai',
  'Achha',
  'Got it',
  'Haan',
  'Sahi',
  'Okay',
  'Alright',
  'Ji',
  'Bilkul',
] as const;

const OPENER_PATTERNS: RegExp[] = [
  /^(hmm+)\b/i,
  /^(dekhta\s+hoon(?:\s+zara)?)\b/i,
  /^(dekhti\s+hoon(?:\s+zara)?)\b/i,
  /^(ek\s+second)\b/i,
  /^(theek\s+hai)\b/i,
  /^(chalo)\b/i,
  /^(achha)\b/i,
  /^(okay)\b/i,
  /^(right)\b/i,
  /^(so)\b/i,
  /^(samajh\s+gay[ai])\b/i,
  /^(got\s+it)\b/i,
  /^(haan)\b/i,
  /^(sahi)\b/i,
  /^(alright)\b/i,
  /^(ji)\b/i,
  /^(bilkul)\b/i,
];

const SALES_BRIDGE_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'agar aap chahen', re: /\bagar\s+aap\s+chahen\b/i },
  { id: 'if you want', re: /\bif\s+you\s+want\b/i },
  { id: 'if you\'d like', re: /\bif\s+you'?d\s+like\b/i },
];

const MAX_RECENT = 2;

export type ConversationFeelState = {
  recentOpeners: string[];
  recentBridges: string[];
  /** True when the last remembered assistant turn ended with a question. */
  lastEndedWithQuestion: boolean;
};

export function emptyConversationFeel(): ConversationFeelState {
  return { recentOpeners: [], recentBridges: [], lastEndedWithQuestion: false };
}

function normalizeOpener(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .replace(/[….]+$/u, '')
    .replace(/[—–-]+$/u, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Collapse gendered / near-duplicate openers into one family key for no-repeat. */
export function openerFamily(opener: string): string {
  const n = normalizeOpener(opener);
  if (/^samajh\s+gay[ai]$/.test(n)) return 'samajh gaya';
  if (/^dekht[ai]\s+hoon(?:\s+zara)?$/.test(n)) return 'dekhta hoon zara';
  if (/^hmm+$/.test(n)) return 'hmm';
  if (/^ek\s+second$/.test(n)) return 'ek second';
  if (/^theek\s+hai$/.test(n)) return 'theek hai';
  if (/^got\s+it$/.test(n)) return 'got it';
  if (/^ji(\s+bilkul)?$/.test(n)) return 'ji';
  return n;
}

/** True when the assistant turn ends in a question (intake / discovery rhythm). */
export function assistantEndedWithQuestion(assistantText: string): boolean {
  const t = assistantText.normalize('NFC').trim();
  if (!t) return false;
  if (/\?\s*$/u.test(t)) return true;
  // Spoken Hinglish often omits "?": "... batao", "... chahiye", "... hai ya"
  if (/\b(kya|hai\s+ya|chahiye|batao|bataiye|bolo|boliye)\s*[.!]?\s*$/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Pull a leading soft opener / ack from an assistant reply, if present.
 * Returns null when the turn starts with the substance (no feel opener).
 */
export function extractLeadingOpener(assistantText: string): string | null {
  const t = assistantText.normalize('NFC').trim();
  if (!t) return null;

  const firstClause = t.split(/(?<=[.!?…])\s+|,\s+|—\s+|–\s+|-\s+/)[0]?.trim() ?? t;
  const candidate = firstClause.length <= 40 ? firstClause : firstClause.slice(0, 40);

  for (const pattern of OPENER_PATTERNS) {
    const match = candidate.match(pattern);
    if (match?.[1]) {
      return openerFamily(match[1]);
    }
  }

  const lower = candidate.toLowerCase();
  for (const phrase of [...SOFT_OPENERS, ...ACKS]) {
    const n = normalizeOpener(phrase);
    if (lower === n || lower.startsWith(`${n} `) || lower.startsWith(`${n},`)) {
      return openerFamily(n);
    }
  }

  return null;
}

/** Detect habitual sales-bridge closers / offers. */
export function extractSalesBridge(assistantText: string): string | null {
  const t = assistantText.normalize('NFC');
  if (!t.trim()) return null;
  for (const { id, re } of SALES_BRIDGE_PATTERNS) {
    if (re.test(t)) return id;
  }
  return null;
}

function pushUniqueRecent(list: string[], value: string): string[] {
  const next = [...list, value];
  while (next.length > MAX_RECENT) next.shift();
  return next;
}

export function rememberAgentOpener(
  state: ConversationFeelState,
  assistantText: string,
): ConversationFeelState {
  let recentOpeners = state.recentOpeners;
  let recentBridges = state.recentBridges;

  const opener = extractLeadingOpener(assistantText);
  if (opener) {
    recentOpeners = pushUniqueRecent(recentOpeners, opener);
  }

  const bridge = extractSalesBridge(assistantText);
  if (bridge) {
    recentBridges = pushUniqueRecent(recentBridges, bridge);
  }

  return {
    recentOpeners,
    recentBridges,
    lastEndedWithQuestion: assistantEndedWithQuestion(assistantText),
  };
}

/**
 * System note for the LLM: avoid repeating recent openers/acks/bridges,
 * and avoid back-to-back discovery questions.
 * Empty string when there is nothing to avoid.
 */
export function buildFeelSystemNote(state: ConversationFeelState): string {
  const hasOpeners = state.recentOpeners.length > 0;
  const hasBridges = state.recentBridges.length > 0;
  const chainNudge = state.lastEndedWithQuestion;
  if (!hasOpeners && !hasBridges && !chainNudge) return '';

  const parts: string[] = ['[SYSTEM: Conversation feel —'];

  if (hasOpeners) {
    const listed = state.recentOpeners.map((o) => `"${o}"`).join(' or ');
    parts.push(
      `do not open with ${listed} (treat "samajh gaya"/"samajh gayi" as the same; "Ji" / "Ji bilkul" as the same). Prefer going straight to the useful answer — never start with Ji this turn if it was used recently.`,
    );
  }

  if (hasBridges) {
    const bridges = state.recentBridges.map((b) => `"${b}"`).join(' or ');
    parts.push(
      `Do not close with ${bridges} / "Agar aap chahen, main aapko…" this turn — ask one short direct question or stop after the answer.`,
    );
  }

  if (chainNudge) {
    parts.push(
      'Your previous turn ended with a discovery question — this turn prefer a value beat (react, recommend, or explain). Do not end with another intake question unless clarifying a vague reply ("chalega", "kuchh aur"); then offer two concrete choices.',
    );
  }

  parts.push(
    'Still keep soft openers rare (complex / multi-point turns only); never every turn.]',
  );

  return parts.join(' ');
}
