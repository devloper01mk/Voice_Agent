/**
 * Lightweight off-topic / personal detector for voice wrap enforcement.
 * Prefer false negatives for product/competitor questions (those stay on call).
 */

import type { CallSpeechLanguage } from './call-language.js';

const PRODUCT_OR_SALES =
  /\b(virtus|taigun|tiguan|volkswagen|vw|car|cars|suv|sedan|price|pricing|emi|loan|demo|test\s*drive|variant|feature|features|mileage|safety|on[- ]?road|ex[- ]?showroom|dealer|booking|safari|nexon|creta|seltos|city|verna|slavia|kushaq|brezza|xuv|rating|ratings|google|gearbox|dsg|technical|complain|complaint|complaints|warranty|service|services|maintenance|reliability|review|reviews|online|showroom)\b|वर्टस|टाइगन|टिगुआन|वोक्सवैगन|कीमत|प्राइस|ईएमआई|डेमो|टेस्ट\s*ड्राइव|कार|एसयूवी|रेटिंग|शिकायत|गियरबाक्स|वारंटी|सर्विस|गूगल|ऑनलाइन/i;

/** Flirty / medical / harassment-style personal (not brand complaints or STT "dating"≈rating). */
const HARD_OFF_TOPIC =
  /\b(sar\s*dard|headache|dawa|medicine|dawai|doctor|pharmacist|ayurved|ayurvedic|hospital|tablet|pain\s*killer|migraine|milna|milne|meet(ing)?|girlfriend|boyfriend|shaadi|marriage|romance|flirt|chaloge|saath\s*chalo|personal\s*number|phone\s*number|whatsapp\s*number|apna\s*number|police|fir|ayurvedic)\b|सर\s*दर्द|दर्द|दवा|दवाई|डॉक्टर|आयुर्वेद|मिलना|मिलने|शादी|नंबर\s*दे|अपना\s*नंबर|साथ\s*चल|चलोगे/i;

/** Ambiguous STT: "dating"/"डेटिंग" often means Google rating when talking cars. */
const DATING_AMBIGUOUS =
  /\b(date|dating)\b|डेट(?:िंग)?/i;

const CLEARLY_FLIRTY =
  /\b(girlfriend|boyfriend|romance|flirt|milna|milne|chaloge|saath\s*chalo|shaadi|marriage|meet(ing)?)\b|मिलना|मिलने|साथ\s*चल|चलोगे|शादी/i;

/**
 * Soft chitchat about the agent's personal life / daily routine.
 * These often never hit HARD_OFF_TOPIC, so the LLM falls into the same refusal skeleton.
 */
/** Time-of-day alone is scheduling ("kal subah do baje") — only with personal/chitchat context. */
const SOFT_CHITCHAT =
  /\b(chai|tea|coffee|nashta|breakfast|lunch|dinner|khana|khaya|khayi|khaye|piya|pii|pi\b|mausam|weather|garam|thand|raat\s*ko|kya\s*(khaya|khayi|piya|kiya)|aapne\s*(kya|subah|kal|shaam)|aap\s*(kahan|kahaan)\s*(se|ho|hai)|umr|age\s*kya|shaadi\s*shuda|boyfriend|girlfriend|(?:subah|shaam)\s+(?:kya|aapne|nashta|chai|khaya|khayi|kiya)|(?:kya|aapne|nashta|chai)\s+(?:subah|shaam))\b|चाय|कॉफी|नाश्ता|खाया|खायी|पी|पिया|मौसम|आपने|क्या\s*खाया|(?:सुबह|शाम)\s*(?:क्या|आपने|नाश्ता|चाय)|(?:क्या|आपने|नाश्ता|चाय)\s*(?:सुबह|शाम)/i;

const OFF_TOPIC = new RegExp(
  `(?:${HARD_OFF_TOPIC.source})|(?:${SOFT_CHITCHAT.source})`,
  'i',
);

export function isLikelyProductOrSalesTurn(text: string): boolean {
  return PRODUCT_OR_SALES.test(text.normalize('NFC'));
}

/**
 * Caller asking who is calling or why this outbound call happened.
 * Stay on the line — this is identity/purpose, never wrap or end_call.
 */
const CALL_PURPOSE_OR_IDENTITY =
  /\b(?:why\s+(?:did\s+you\s+|have\s+you\s+)?call(?:ed|ing)?|call(?:ed|ing)?\s+(?:me\s+)?(?:for\s+)?wh(?:y|at)|kaun\s+bol|kaun\s+hai(?:\s+aap)?|who\s+(?:is\s+this|are\s+you|calling)|aap\s+kaun|kaha?a?n\s+se|kahaa\s+se|kis\s+kshetra|which\s+(?:region|area|city))\b|\bcall\b.{0,48}\b(?:ky[ou]n+k?i?|kyu+|kyunki|kyumki|isliye|kaha?a?n|kahaa|where|from)\b|\b(?:ky[ou]n+k?i?|kyu+|kyunki|kyumki|isliye)\b.{0,48}\bcall\b|कॉल.{0,40}(?:क्यों|किउ|कियो|इसलिए|कहाँ|कहां|किस|से)|(?:क्यों|किउ|कियो|इसलिए).{0,40}कॉल|कौन\s+बोल|कहाँ\s+से|कहां\s+से|किस\s+क्षेत्र|यह\s+कहाँ/i;

export function isCallPurposeOrIdentityTurn(text: string): boolean {
  const t = text.normalize('NFC').trim();
  if (!t) return false;
  return CALL_PURPOSE_OR_IDENTITY.test(t);
}

export function buildCallPurposeSystemNote(
  productName: string,
  opts?: { leadSourceAnswer?: string },
): string {
  const leadHint = opts?.leadSourceAnswer?.trim();
  const sourceLine = leadHint
    ? `If they ask where you are calling from / lead source, paraphrase: ${leadHint} `
    : 'If they ask where you are calling from, say you are on the authorised outbound team for that brand in India. ';
  return (
    `[SYSTEM: Caller asked who you are, why you called, or where you are calling from. This is IDENTITY — not off-topic, not not-interested, not a goodbye. ` +
    `Restate in one sentence: you called from ${productName} as a follow-up to help them choose / continue their enquiry. ` +
    sourceLine +
    `Do NOT repeat your full opener or re-introduce yourself from scratch. ` +
    `Then ask ONE next-step question (price by city, or test drive). ` +
    `NEVER say you are closing the call. NEVER call end_call.]`
  );
}

/** Injected when off-topic strikes exceed limit — LLM generates goodbye, not a fixed script. */
export function buildWrapLimitSystemNote(productName: string): string {
  return (
    `[SYSTEM: The caller has stayed off-topic for several turns. ` +
    `Give a warm, natural goodbye in your own words (1–2 short sentences) mentioning ${productName} if helpful. ` +
    `Then call end_call. Do NOT read a fixed script. Do NOT pitch again.]`
  );
}

function isAmbiguousDatingWithProduct(text: string): boolean {
  const t = text.normalize('NFC');
  if (!DATING_AMBIGUOUS.test(t)) return false;
  if (CLEARLY_FLIRTY.test(t)) return false;
  return isLikelyProductOrSalesTurn(t);
}

export function isLikelyOffTopicOrPersonalTurn(text: string): boolean {
  const t = text.normalize('NFC').trim();
  if (!t) return false;

  if (isCallPurposeOrIdentityTurn(t)) return false;

  // STT "dating"/"डेटिंग" amid car/reliability talk → treat as product (rating), not personal.
  if (isAmbiguousDatingWithProduct(t)) return false;

  // Competitor / model / reliability asks stay on-call unless clearly flirty/harassment.
  if (isLikelyProductOrSalesTurn(t) && !CLEARLY_FLIRTY.test(t)) {
    return false;
  }

  // Bare dating with no product context and no flirty verbs: prefer clarify path via LLM,
  // but still flag as soft off-topic only when clearly flirty or medical/hard patterns match.
  if (DATING_AMBIGUOUS.test(t) && !CLEARLY_FLIRTY.test(t) && !HARD_OFF_TOPIC.test(t) && !SOFT_CHITCHAT.test(t)) {
    return false;
  }

  return OFF_TOPIC.test(t);
}

export function withProductPlaceholder(template: string, productName: string): string {
  return template.replaceAll('{product_name}', productName);
}

/**
 * Injected into the user turn so the LLM generates a fresh formal decline+redirect.
 * This is guidance only — not a spoken canned reply.
 */
export function buildOffTopicRedirectSystemNote(options: {
  productName: string;
  strike: number;
  maxRedirects: number;
  forceAtStrike: number;
  /** Active call speech language; defaults to hinglish when unset. */
  speechLanguage?: CallSpeechLanguage | null;
}): string {
  const { productName, strike, maxRedirects, forceAtStrike } = options;
  const speechLanguage = options.speechLanguage ?? 'hinglish';
  const wrapWarn =
    strike >= maxRedirects
      ? ` If they stay off-topic next turn the call will end (strike ${strike}/${forceAtStrike - 1}).`
      : '';

  if (speechLanguage === 'en') {
    return (
      `[SYSTEM: Off-topic or personal chitchat (strike ${strike}). ` +
      `Generate a short English reply yourself — do not read a fixed script.${wrapWarn} ` +
      `FORBIDDEN openings/patterns this call (do not reuse): ` +
      `"I'm here for ${productName}", "I only help with …", ` +
      `"I can't help with this topic / personal matters", "Maaf kijiye / Sorry I can't comment", ` +
      `or the same model/price/comparison/test-drive laundry list every turn. ` +
      `DO: vary the opening (not always "Sorry"); briefly decline ONLY true personal/flirty/medical-about-you topics; ` +
      `if the transcript might be a car rating / reliability / service mishear, ask ONE short clarify instead of refusing. ` +
      `Then ask ONE fresh ${productName} question (vary each turn). ` +
      `Never treat brand complaints, Google ratings, gearbox, warranty, or free service questions as personal.]`
    );
  }

  return (
    `[SYSTEM: Off-topic or personal chitchat (strike ${strike}). ` +
    `Generate a short Roman Hinglish reply yourself — do not read a fixed script.${wrapWarn} ` +
    `FORBIDDEN openings/patterns this call (do not reuse): ` +
    `"Main ${productName} ke liye hoon", "Main sirf … pe help karti hoon", ` +
    `"is topic / personal baaton par help nahi kar sakti", "Maaf kijiye, us subject/topic par…", ` +
    `or the same model/price/comparison/test-drive laundry list every turn. ` +
    `DO: vary the opening (not always "Maaf kijiye" or "Ji"); briefly decline ONLY true personal/flirty/medical-about-you topics; ` +
    `if transcript maybe rating / gearbox / kitne services mishear, ask ONE short clarify instead of refusing. ` +
    `Then ask ONE fresh ${productName} question (vary each turn). ` +
    `Never treat brand complaints, Google ratings, gearbox, warranty, or free service questions as personal.]`
  );
}
