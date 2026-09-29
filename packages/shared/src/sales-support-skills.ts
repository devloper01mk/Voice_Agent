/**
 * Sales + support behaviour from SkillsConfig → live system prompt + turn notes.
 * Brain / Product Knowledge = facts. Skills = how to talk and when to close.
 */

import type { AgentGender, SkillsConfig } from './skills-types.js';
import { lockSpokenHinglishGender } from './hinglish-gender.js';

function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function inflectSkillCopy(text: string, gender: AgentGender): string {
  let out = text;
  if (gender === 'male') {
    out = out
      .replaceAll('samajh sakti hoon', 'samajh sakta hoon')
      .replaceAll('Samajh sakti hoon', 'Samajh sakta hoon')
      .replaceAll('rakhti hoon', 'rakhta hoon')
      .replaceAll('karti hoon', 'karta hoon')
      .replaceAll('bataungi', 'bataunga')
      .replaceAll('le jaati hoon', 'le jata hoon')
      .replaceAll('bol rahi', 'bol raha');
  }
  return lockSpokenHinglishGender(out, gender);
}

/** How many replies to keep "answer first — no booking pitch" sticky. */
export const DEFER_BOOKING_STICKY_TURNS = 3;

/**
 * Caller explicitly wants info / facilities / sightseeing first — stop booking funnel.
 * Covers corrections like "hamesha booking pe kyun jaate ho".
 */
const DEFER_BOOKING_ASK =
  /\b(?:pehle\s+(?:bata(?:o|iye|na)|jawab|detail|details|facilities?|facility|suniye|suno)|booking\s+(?:se\s+)?pehle|pehle\s+(?:meri?\s+)?(?:pasand|baat)|hamesha\s+booking|booking\s+(?:par|pe|mein)\s+(?:kyun|kyu|mat)|mat\s+(?:jao|jaao|jaana)\s+booking|don'?t\s+(?:push|jump\s+to)\s+booking|stop\s+(?:pushing\s+)?booking|answer\s+first|facilities?\s+(?:pehle|bata)|ghumne\s+(?:ki\s+)?jagah|sightseeing\s+first|last\s+mein\s+booking)\b|पहले\s*(?:बताओ|बताइए|जवाब|डिटेल)|बुकिंग\s*(?:से\s*)?पहले|हमेशा\s*बुकिंग|बुकिंग\s*(?:पर|पे)\s*(?:क्यों|मत)|फैसिलिटी|घूमने\s*की\s*जगह/i;

const FRUSTRATED_OR_ANGRY =
  /\b(?:frustrated|frustrate|angry|annoyed|irritated|upset|gussa|gusaa|naraz|pareshan|bakwas|bekaar|useless|harami|saala|madarchod|bhenchod)\b|गुस्सा|नाराज|परेशान|बकवास|बेकार/i;

const CLEAR_BOOK_INTENT =
  /\b(?:book(?:ing)?\s+kar(?:\s*(?:na|o|do|dein|dijie|diijiye))?|reserve\s+kar|le\s+lunga|le\s+leti|confirm\s+kar(?:\s*(?:do|dein|na))?|yes\s+book|haan?\s+book|book\s+it|i\s+want\s+to\s+book)\b|बुक\s*कर|बुकिंग\s*कर|कन्फर्म\s*कर/i;

export function isDeferBookingAsk(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (CLEAR_BOOK_INTENT.test(t)) return false;
  return DEFER_BOOKING_ASK.test(t);
}

export function isFrustratedOrAngryTurn(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return FRUSTRATED_OR_ANGRY.test(t);
}

export function isClearBookIntent(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return CLEAR_BOOK_INTENT.test(t);
}

export function buildDeferBookingSystemNote(): string {
  return (
    '[SYSTEM: Caller asked for information FIRST — do NOT pitch booking, collect name/phone, ' +
    'or say "booking start / details collect / confirm ho jayegi" this turn or the next few. ' +
    'Answer only from Product Knowledge (and live tools if needed). One short useful answer; ' +
    'at most one clarifying question. Soft close ONLY after they clearly ask to book.]'
  );
}

export function buildAngryCallerSystemNote(
  acknowledge: string,
  deescalate: string,
): string {
  const ack = acknowledge.trim() || 'I understand this is frustrating.';
  const calm = deescalate.trim() || 'I will keep this simple and focus on what you need.';
  return (
    `[SYSTEM: Caller seems frustrated or angry. Stay sales+support: calm, short, no pitch. ` +
    `Acknowledge meaning: "${ack}" then help meaning: "${calm}". ` +
    `Paraphrase — never copy templates verbatim. No booking push this turn.]`
  );
}

function meaningLine(label: string, raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return `- **${label}** (paraphrase, never copy verbatim): ${t}`;
}

/**
 * Inject Studio skills into the compiled prompt as behaviour meanings.
 * Product facts stay in Product Knowledge / Brain — this is *how* to behave.
 */
export function buildSalesSupportSkillsPrompt(
  skills: SkillsConfig,
  productName: string,
  _agentName: string,
  gender: AgentGender,
): string {
  const angry = skills.angry;
  const busy = skills.busy;
  const support = skills.support;
  const objection = skills.objection;
  const discovery = skills.discovery;
  const competitor = skills.competitor;
  const exit = skills.exit;
  const abusive = skills.core?.abusive?.boundaryLine?.trim();
  const demoOffer = skills.demoOfferScript?.trim();
  const m = (label: string, raw: string) => meaningLine(label, inflectSkillCopy(raw, gender));

  const lines = [
    `## Sales & support skills (how to behave)`,
    `- **Two sources every turn:** (1) **Product Knowledge / Brain** = facts (price, rooms, facilities, policies, cities). (2) **These skills** = how a sales+support person talks. Never invent facts outside Brain/tools. Never dump a full price menu unless they asked for rates/options.`,
    `- You are both **salesperson and support advisor** for ${productName}: listen → answer from Brain → guide → soft close only when ready.`,
    `- **Answer-first lock:** If they say pehle batao / facilities pehle / booking mat dhakelo / hamesha booking pe mat jao — answer only; zero booking/intake pitch until clear book intent.`,
    `- **Trust / complaint** (e.g. "wahan koi nahi hota", account/payment doubt): address from Brain/policies first; never invent "booking confirm ho jayegi".`,
    m('Angry / frustrated — acknowledge', angry.acknowledge),
    m('Angry / frustrated — de-escalate', angry.deescalate),
    abusive ? m('Abusive — calm boundary (then end_call if it continues)', abusive) : '',
    m('Busy — acknowledge', busy.acknowledge),
    m('Busy — ask callback time', busy.callbackQuestion),
    m('Support / existing issue — acknowledge', support.acknowledge),
    m('Support — collect contact', support.collectContact),
    m('Support — handoff promise', support.handoffPromise),
    m('Objection — empathy', objection.empathyLine),
    m('Objection — price/budget', objection.priceResponse),
    m('Objection — happy with current', objection.excelResponse),
    m('Objection — think it over', objection.thinkItOverResponse),
    m('Discovery — open', discovery.openQuestion),
    m('Discovery — need probe', discovery.painProbe),
    m('Discovery — current tools/options', discovery.currentToolsQuestion),
    m(
      'Competitor — fair boundary',
      competitor.boundaryTemplate.replaceAll('{product_name}', productName),
    ),
    m('Competitor — pivot', competitor.pivotQuestion),
    m('Competitor — next step bridge', competitor.demoBridge),
    m('Exit — not interested', exit.notInterestedLine),
    m('Exit — polite close', exit.politeClose),
    demoOffer ? m('Demo / next-step offer (only on clear intent)', demoOffer) : '',
    `- **Close rule:** Soft close / capture_demo_lead only on clear buy/book/demo/visit intent. Until then: Brain answers + at most one helpful question.`,
  ].filter(Boolean);

  return lines.join('\n');
}
