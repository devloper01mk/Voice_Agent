/**
 * Same-call facts notepad — remember anything answered this call and never re-ask.
 * Lives only for the current call (fresh empty state on next call).
 * Does not replace ProspectMemory / Known contact (cross-call).
 */

export type CallFactKey =
  | 'intent'
  | 'model'
  | 'bodyType'
  | 'city'
  | 'area'
  | 'preferred_time'
  | 'name'
  | 'budget'
  | string;

export type CallFactsState = {
  /** Confirmed / answered facts this call. */
  facts: Record<string, string>;
  /** Topics the assistant already asked about (even before answer). */
  asked: Set<string>;
};

export function emptyCallFacts(): CallFactsState {
  return { facts: {}, asked: new Set() };
}

const FALLBACK_MODEL_NAMES =
  'virtus|taigun|tiguan|polo|vento|ameo|passat|jetta|t-?roc|t-?cross';

function escapeModelToken(name: string): string {
  return name
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

/** Heading / bold tokens from Product Knowledge so CALL FACTS is not VW-only. */
export function extractCatalogModelNames(knowledge: string): string[] {
  if (!knowledge.trim()) return [];
  const names: string[] = [];
  for (const m of knowledge.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const title = m[1].replace(/[*_`]/g, '').split(/[:–—-]/)[0]?.trim() ?? '';
    const token = title.split(/\s+/).slice(0, 3).join(' ');
    if (token.length >= 2 && token.length <= 40 && /[A-Za-z]/.test(token)) {
      names.push(token);
      const first = token.split(/\s+/)[0];
      if (first && first.length >= 3 && first !== token) names.push(first);
    }
  }
  for (const m of knowledge.matchAll(/\*\*([A-Za-z][A-Za-z0-9+.\-]{1,32})\*\*/g)) {
    names.push(m[1]);
  }
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 40);
}

function modelRegex(knowledge?: string): RegExp {
  const extras = extractCatalogModelNames(knowledge ?? '')
    .map(escapeModelToken)
    .filter((n) => n.length >= 2);
  const parts = extras.length ? `${FALLBACK_MODEL_NAMES}|${extras.join('|')}` : FALLBACK_MODEL_NAMES;
  return new RegExp(`\\b(${parts})\\b`, 'i');
}

const BODY_RE = /\b(sedan|suv|hatchback|coupe)\b|एसयूवी|सेडान/i;

const CITY_RE =
  /\b(jaipur|delhi|mumbai|pune|bangalore|bengaluru|hyderabad|chennai|kolkata|ahmedabad|surat|indore|lucknow|chandigarh|gurgaon|gurugram|noida|jaipur)\b|जयपुर|दिल्ली|मुंबई|पुणे|बैंगलोर|हैदराबाद/i;

const AREA_RE =
  /\b(vaishali\s*nagar|malviya\s*nagar|c[\s-]?scheme|mansarovar|tonk\s*road|sitapura|jagatpura|bapu\s*nagar|raja\s*park)\b|वैशाली\s*नगर|मालवीय\s*नगर/i;

const INTENT_SHOWROOM =
  /\b(showroom\s*visit|showroom|dealer\s*visit|visit\s*(the\s*)?showroom)\b|शोरूम/i;
const INTENT_TEST_DRIVE =
  /\b(test\s*drive|testdrive)\b|टेस्ट\s*ड्राइव/i;

const TIME_RE =
  /\b((?:aaj|kal|parso|today|tomorrow)\s*)?(\d{1,2}\s*(?::\s*\d{2})?\s*(?:am|pm|baje)?|\d{1,2}\s*(?:am|pm)|subah|shaam|dopahar|evening|morning|afternoon|5\s*pm|10\s*am|11\s*am)\b|आज|कल|परसों|सुबह|शाम|दोपहर/i;

const BUDGET_RE =
  /\b(\d+(?:\.\d+)?\s*(?:lakh|lac|cr|crore)|under\s*\d+|budget\s*\d+)\b|\d+\s*लाख/i;

/** Map assistant utterance → topic keys they asked about. */
export function detectAskedTopics(assistantText: string, catalogKnowledge = ''): string[] {
  const t = assistantText.trim();
  if (!t) return [];
  const asked: string[] = [];
  const models = modelRegex(catalogKnowledge);
  if (
    /\b(model|kaunsa|konsa|which\s+car|dekh\s*rahe)\b|कौन\s*सा|कौनसी/i.test(t) ||
    models.test(t)
  ) {
    asked.push('model');
  }
  if (/\b(sedan|suv|hatchback|body\s*type)\b|सेडान|एसयूवी/i.test(t)) {
    asked.push('bodyType');
  }
  if (/\b(city|area|kahan|kahaan|location|aas-?paas|near|showroom)\b|कहां|कहाँ|शहर|एरिया/i.test(t)) {
    asked.push('city');
    if (/\b(area|nagar|locality|paas)\b|नगर|एरिया/i.test(t)) asked.push('area');
  }
  if (
    /\b(time|slot|kab|when|subah|shaam|am|pm|convenient|aaj|kal)\b|कब|स्लॉट|समय|सुबह|शाम/i.test(
      t,
    )
  ) {
    asked.push('preferred_time');
  }
  if (/\b(naam|name|full\s*name)\b|नाम/i.test(t)) {
    asked.push('name');
  }
  if (/\b(budget|kitne|price\s*range|lakh)\b|बजट|लाख/i.test(t)) {
    asked.push('budget');
  }
  if (/\b(showroom|test\s*drive|visit|demo)\b|शोरूम|टेस्ट/i.test(t)) {
    asked.push('intent');
  }
  return [...new Set(asked)];
}

function titleCaseModel(m: string): string {
  const lower = m.toLowerCase().replace(/t-roc/i, 'T-Roc').replace(/t-cross/i, 'T-Cross');
  if (lower === 't-roc' || lower === 'T-Roc') return 'T-Roc';
  if (lower === 't-cross' || lower === 'T-Cross') return 'T-Cross';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const CLOCK_TIME_RE =
  /\b(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm|baje)\b/i;
const CALENDAR_MONTH_RE =
  /\b\d{1,2}\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|जनवरी|फरवरी|मार्च|अप्रैल|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर/i;

function extractPreferredTimePhrase(t: string, slotPending: boolean): string | undefined {
  if (CALENDAR_MONTH_RE.test(t) && !CLOCK_TIME_RE.test(t)) return undefined;

  const hasClock = CLOCK_TIME_RE.test(t);
  const hasTod = /\b(subah|shaam|dopahar|evening|morning|afternoon)\b|सुबह|शाम|दोपहर/i.test(t);
  if (!slotPending && !hasClock && !hasTod) return undefined;

  const colon = t.match(/\b(\d{1,2})\s*:\s*(\d{2})\s*(am|pm)?\b/i);
  const marked = t.match(/\b(\d{1,2})\s*(am|pm|baje)\b/i);
  const day = t.match(/\b(aaj|kal|parso|today|tomorrow)\b|आज|कल|परसों/i);
  const parts: string[] = [];
  if (day) {
    const d = day[0].toLowerCase();
    if (/aaj|आज|today/i.test(d)) parts.push('today');
    else if (/kal|कल|tomorrow/i.test(d)) parts.push('tomorrow');
    else if (/parso|परसों/i.test(d)) parts.push('day after tomorrow');
  }
  if (colon) {
    const h = colon[1];
    const min = colon[2];
    const ap = (colon[3] || '').toLowerCase();
    parts.push(ap ? `${h}:${min} ${ap.toUpperCase()}` : `${h}:${min}`);
  } else if (marked) {
    const h = marked[1];
    const unit = marked[2].toLowerCase();
    parts.push(unit === 'baje' ? `${h} baje` : `${h} ${unit.toUpperCase()}`);
  } else if (hasTod) {
    if (/\bshaam|evening|शाम/i.test(t)) parts.push('evening');
    else if (/\bsubah|morning|सुबह/i.test(t)) parts.push('morning');
    else if (/\bdopahar|afternoon|दोपहर/i.test(t)) parts.push('afternoon');
  } else if (slotPending && TIME_RE.test(t)) {
    return t.slice(0, 80);
  }
  return parts.length ? parts.join(' ') : undefined;
}

/** Extract fact values from a user utterance (and optional pending asked topics). */
export function extractFactsFromUserTurn(
  userText: string,
  pendingAsked: Iterable<string> = [],
  catalogKnowledge = '',
): Record<string, string> {
  const t = userText.trim();
  if (!t) return {};
  const out: Record<string, string> = {};
  const pending = new Set(pendingAsked);
  const models = modelRegex(catalogKnowledge);

  const model = t.match(models);
  if (model?.[1]) out.model = titleCaseModel(model[1]);

  const body = t.match(BODY_RE);
  if (body) {
    const b = body[0].toLowerCase();
    if (/suv|एसयूवी/i.test(b)) out.bodyType = 'SUV';
    else if (/sedan|सेडान/i.test(b)) out.bodyType = 'sedan';
    else if (/hatch/i.test(b)) out.bodyType = 'hatchback';
    else out.bodyType = b;
  }

  const city = t.match(CITY_RE);
  if (city?.[0]) {
    const c = city[0];
    if (/जयपुर|jaipur/i.test(c)) out.city = 'Jaipur';
    else if (/दिल्ली|delhi/i.test(c)) out.city = 'Delhi';
    else if (/मुंबई|mumbai/i.test(c)) out.city = 'Mumbai';
    else out.city = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
  }

  const area = t.match(AREA_RE);
  if (area?.[0]) {
    const a = area[0].replace(/\s+/g, ' ').trim();
    if (/वैशाली|vaishali/i.test(a)) out.area = 'Vaishali Nagar';
    else if (/मालवीय|malviya/i.test(a)) out.area = 'Malviya Nagar';
    else out.area = a;
  }

  if (INTENT_TEST_DRIVE.test(t)) out.intent = 'test_drive';
  else if (INTENT_SHOWROOM.test(t)) out.intent = 'showroom_visit';

  const extractedTime = extractPreferredTimePhrase(t, pending.has('preferred_time'));
  if (extractedTime) out.preferred_time = extractedTime;

  const budget = t.match(BUDGET_RE);
  if (budget?.[0]) out.budget = budget[0].replace(/\s+/g, ' ').trim();

  // Name: only when we were asking for name, and utterance looks like a name (not digits-only)
  if (pending.has('name') && !/^\d[\d\s.-]*$/.test(t) && t.length <= 60) {
    const reject = /\b(nahi|nahin|galat|wrong|नहीं|गलत)\b/i.test(t);
    if (!reject && !models.test(t) && !INTENT_SHOWROOM.test(t) && !INTENT_TEST_DRIVE.test(t)) {
      // Spelled letters: "R A G H I B" or "आरए जी..."
      const spelled = t.match(/\b([A-Za-z])(?:\s*[,\s]\s*([A-Za-z])){2,}\b/);
      if (spelled) {
        const letters = t.match(/\b[A-Za-z]\b/g);
        if (letters && letters.length >= 3) {
          out.name = letters.join('').toUpperCase();
        }
      } else if (/^[A-Za-z][A-Za-z\s.'-]{1,40}$/.test(t) || /[\u0900-\u097F]/.test(t)) {
        // Avoid pure confirm cues as name
        if (!/^(haan|han|yes|sahi|theek|ok|okay|bilkul)\b/i.test(t)) {
          out.name = t.replace(/\s+/g, ' ').trim();
        }
      }
    }
  }

  // If assistant asked model and user only said a body type, still ok; if asked city and only area, keep area.
  return out;
}

/** Detect caller correcting a prior fact ("X nahi Y"). */
export function applyCorrections(
  userText: string,
  facts: Record<string, string>,
  catalogKnowledge = '',
): Record<string, string> {
  const t = userText.trim();
  const next = { ...facts };
  const models = modelRegex(catalogKnowledge);
  const modelCorr =
    t.match(
      new RegExp(`${models.source}.{0,20}\\b(nahi|nahin|not)\\b.{0,20}${models.source}`, 'i'),
    ) || t.match(new RegExp(`\\b(nahi|nahin|not)\\b.{0,12}${models.source}`, 'i'));
  if (modelCorr) {
    const found = [...t.matchAll(new RegExp(models.source, 'gi'))].map((m) =>
      titleCaseModel(m[1] || m[0]),
    );
    if (found.length) next.model = found[found.length - 1];
  }
  return next;
}

export function mergeCallFacts(
  state: CallFactsState,
  patch: {
    askedTopics?: string[];
    facts?: Record<string, string>;
  },
): CallFactsState {
  const asked = new Set(state.asked);
  for (const k of patch.askedTopics ?? []) asked.add(k);
  const facts = { ...state.facts, ...(patch.facts ?? {}) };
  return { facts, asked };
}

export function updateCallFactsFromTurn(options: {
  state: CallFactsState;
  userText: string;
  lastAssistantText?: string;
  recentAssistantTexts?: string[];
  catalogKnowledge?: string;
}): CallFactsState {
  const {
    state,
    userText,
    lastAssistantText = '',
    recentAssistantTexts = [],
    catalogKnowledge = '',
  } = options;
  const askedFromAssistant = [
    ...detectAskedTopics(lastAssistantText, catalogKnowledge),
    ...recentAssistantTexts.flatMap((t) => detectAskedTopics(t, catalogKnowledge)),
  ];
  const pending = new Set([
    ...detectAskedTopics(lastAssistantText, catalogKnowledge),
    ...[...state.asked].filter((k) => !state.facts[k]),
  ]);

  const extracted = extractFactsFromUserTurn(userText, pending, catalogKnowledge);
  const merged = { ...state.facts, ...extracted };
  const corrected = applyCorrections(userText, merged, catalogKnowledge);

  // Name confirm: if last assistant read back a name and user says haan
  if (
    /\b(maine\s+suna|yeh\s+sahi\s+hai)\b/i.test(lastAssistantText) &&
    /\b(haan|han|yes|sahi|theek|bilkul|sahi\s*hai|धन्यवाद)\b/i.test(userText)
  ) {
    const heard = lastAssistantText.match(
      /maine\s+suna\s+(.+?)\s*[—\-–]|suna\s+(.+?)\s*[—\-–]/i,
    );
    const nameBit = (heard?.[1] || heard?.[2] || '').replace(/\s*yeh\s*sahi.*/i, '').trim();
    if (nameBit && nameBit.length < 60) {
      corrected.name = nameBit.replace(/\s+/g, ' ');
    }
  }

  return mergeCallFacts(state, {
    askedTopics: askedFromAssistant,
    facts: corrected,
  });
}

export function buildCallFactsSystemNote(state: CallFactsState): string | null {
  const entries = Object.entries(state.facts).filter(([, v]) => v && String(v).trim());
  if (entries.length === 0 && state.asked.size === 0) return null;

  const known = entries.map(([k, v]) => `${k}=${v}`).join('; ') || '(none yet)';
  const askedOnly = [...state.asked].filter((k) => !state.facts[k]);
  const askedLine =
    askedOnly.length > 0 ? ` Topics already asked (awaiting/partial): ${askedOnly.join(', ')}.` : '';

  return (
    `[System: CALL FACTS THIS CALL — already known: ${known}.${askedLine} ` +
    `NEVER re-ask any known fact (model, bodyType, city, area, preferred_time, name, intent, budget, or anything listed). ` +
    `Ask ONLY missing information. Do NOT restart discovery or option menus already answered this call. ` +
    `If caller corrects a fact, update silently and continue — do not re-open the full questionnaire. ` +
    (state.facts.booking === 'saved'
      ? `BOOKING LOCKED this call — do not call capture_demo_lead again unless the caller asks to change the time. Restate the same preferred_time. NEVER say the slot is full or offer other times. On thank-you / bye, confirm the same slot and end_call. `
      : `No booking was saved this call — never invent or announce an appointment time. `) +
    `This notepad is THIS CALL only; next call starts fresh.]`
  );
}

/** Test helper: serialize asked set. */
export function callFactsSnapshot(state: CallFactsState): {
  facts: Record<string, string>;
  asked: string[];
} {
  return { facts: { ...state.facts }, asked: [...state.asked].sort() };
}

const CHOICE_VERBS =
  /\b(go\s+with|i'?ll\s+go|going\s+with|choose|chahiye|dekhna|le\s+(?:lunga|lungi|lete)|lunga|lungi)\b|चाहिए|देखना|लूंगा|लूंगी/i;

const NEXT_STEP_ASK =
  /\bwhat\s+do\s+you\s+want\s+me\s+to\s+do\b|\btell\s+(?:me\s+)?what\s+to\s+do\b|\bnext\s+step\b|\bkya\s+(?:karun|karna(?:\s+hai)?|chahiye)\b|\baap\s+kya\s+chah(?:te|ti)\b|क्या\s+(?:करूँ|करना)/i;

/** Caller picked sedan/SUV/a model — buying interest, not a close. */
export function isProductChoiceInterestTurn(text: string, catalogKnowledge = ''): boolean {
  const t = text.normalize('NFC').trim();
  if (!t) return false;
  if (/\b(not\s+interested|nahi\s+chahiye|mat\s+call)\b|नहीं\s*चाहिए/i.test(t)) return false;
  const hasBody = BODY_RE.test(t);
  const hasModel = modelRegex(catalogKnowledge).test(t);
  if (!hasBody && !hasModel) return false;
  if (CHOICE_VERBS.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  return words <= 10;
}

/** Caller asked what they should do next — not a goodbye. */
export function isNextStepAskTurn(text: string): boolean {
  const t = text.normalize('NFC').trim();
  if (!t) return false;
  return NEXT_STEP_ASK.test(t);
}

export function callFactsGainedProductChoice(
  prev: CallFactsState,
  next: CallFactsState,
): boolean {
  const bodyNew = Boolean(next.facts.bodyType && next.facts.bodyType !== prev.facts.bodyType);
  const modelNew = Boolean(next.facts.model && next.facts.model !== prev.facts.model);
  return bodyNew || modelNew;
}

export function buildBuyingInterestSystemNote(): string {
  return (
    '[SYSTEM: Caller chose a listed offering / plan / model. This is BUYING INTEREST — not not-interested, not a goodbye. ' +
    'Recommend the matching item from Product Knowledge. Give ONE new fact, then offer the next step listed there. ' +
    'NEVER say thanks-for-your-time. NEVER call end_call. NEVER invent a booking time.]'
  );
}

export function buildNextStepAskSystemNote(): string {
  return (
    '[SYSTEM: Caller asked what you want them to do / what the next step is. ' +
    'Tell them the next action in one sentence from Product Knowledge (demo, visit, or one useful question). ' +
    'Do NOT recap options already chosen. Do NOT hang up. NEVER call end_call.]'
  );
}
