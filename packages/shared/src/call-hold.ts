/**
 * Detect hold / resume cues on live calls so the agent can mute
 * while the caller talks to someone else, then continue on resume.
 */

export const HOLD_ACK_LINE = 'Ji.';
export const HOLD_SOFT_CHECKIN_LINE = 'Main line pe hoon, jab ready ho boliye.';
export const HOLD_SOFT_CHECKIN_MS = 70_000;

/** Injected into the user turn so the LLM resumes without re-greeting. */
export const HOLD_RESUME_SYSTEM_NOTE =
  '[SYSTEM: Caller was on a brief hold (often a side conversation). They are back now. Continue briefly from your last pending question or topic — do not restart greeting or re-introduce yourself. Do not comment on their side conversation.]';

const STRONG_HOLD =
  /\b((ek|eka|one|1)\s*(min(ute)?s?|sec(ond)?s?)(\s*(hold|ruk|wait|rukna))?|(hold|line\s*hold)\s*(kar(o|na|do)?|please|on)?|ruk(\s*jao|\s*na|\s*jaoe)?|thoda\s*(ruk|wait|time)|bas\s*(ek\s*)?(sec|second|min|minute)|wait\s*(kar(o|na)?|a\s*sec|ek\s*min|one\s*min)?|minute\s*(do|dena|rukna)|ek\s*second)\b/i;

const FALSE_HOLD =
  /\b(wait\s*time|waitlist|waiting\s*(period|list)|delivery\s*wait|kitna\s*wait)\b/i;

/** Lightweight product/sales hint (mirrors off-topic-wrap) for hold exit. */
const PRODUCT_HINT =
  /\b(virtus|taigun|tiguan|volkswagen|vw|car|cars|suv|sedan|price|pricing|emi|loan|demo|test\s*drive|variant|feature|features|mileage|safety|on[- ]?road|ex[- ]?showroom|dealer|booking|safari|nexon|creta|seltos|city|verna|slavia|kushaq|brezza|xuv)\b|वर्टस|टाइगन|टिगुआन|वोक्सवैगन|कीमत|प्राइस|ईएमआई|डेमो|टेस्ट\s*ड्राइव|कार|एसयूवी/i;

/** Short / clear cues that mean "I'm back on the line". */
const RESUME_CUE =
  /^(hello+|h[ae]llo+|h[aā]ji|haaji|haan\s*bolo|ji(\s*(boliye|bolo|suniye|sunao))?|suniye|suno\s*ji|bolo\s*ji|main\s*(aa\s*gaya|aa\s*gayi|wapas|ready)|haan\s*main(\s*aa\s*gaya)?|sorry\s*(yaar\s*)?(wait|holding|hold)|thanks?\s*for\s*(waiting|holding)|line\s*pe\s*(ho|hai)?|are\s*you\s*(there|on)|sun\s*rahe\s*ho)\s*[.!?]*$/i;

function normalizeTurn(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function looksLikeProductTurn(text: string): boolean {
  return PRODUCT_HINT.test(text);
}

/** True when the caller is asking the agent to wait / hold. */
export function isHoldRequest(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t || FALSE_HOLD.test(t)) return false;
  if (!STRONG_HOLD.test(t)) return false;

  const words = t.split(/\s+/).length;
  // Long product questions with "wait" already partially filtered via FALSE_HOLD;
  // still avoid treating long sales Qs as hold unless they clearly say hold/ruk.
  if (words > 18 && looksLikeProductTurn(t) && !/\b(hold|ruk\s*jao|rukna)\b/i.test(t)) {
    return false;
  }
  return true;
}

/** Clear resume phrases used only while already in HOLD. */
export function isHoldResumeCue(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  return RESUME_CUE.test(t);
}

/**
 * Whether HOLD should end for this utterance.
 * Resume cues always exit; product/sales directed at the agent also exit
 * (caller came back without saying hello). Side talk stays muted.
 */
export function shouldExitHold(text: string): boolean {
  const t = normalizeTurn(text);
  if (!t) return false;
  if (isHoldResumeCue(t)) return true;
  if (/\b(ji\s*suniye|suniye\s*ji|line\s*pe\s*(ho|hai)|are\s*you\s*(there|on))\b/i.test(t)) {
    return true;
  }
  if (looksLikeProductTurn(t)) return true;
  return false;
}
