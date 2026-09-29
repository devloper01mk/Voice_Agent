import { looksLikeBookingConfirmedClaim } from './simulator2-turn.js';
import type { CallLanguageLock } from './call-language.js';

const PHONE_CUE = /\b(number|mobile|phone|whatsapp)\b/i;
const NAME_CUE =
  /\b(?:my\s+name\s+is|i\s+am|i'm|naam\s+hai|mera\s+naam)\s+([A-Za-z][A-Za-z.'\-]*(?:\s+(?!and\b|or\b|and\s+my\b)[A-Za-z][A-Za-z.'\-]*){0,3})/i;
const AGREES_RE =
  /\b(yes[,.]?\s+that\s+is|that\s+is\s+correct|that\s+is\s+the\s+total|yes,\s*the\s+total|pakka|sahi\s+hai)\b/i;
const ACCEPTS_INTAKE_RE =
  /\b(payment\s+link|got\s+your\s+number|have\s+your\s+number|noted\s+your\s+number|share\s+a\s+secure)\b/i;

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export type SpokenIntakeInput = {
  language: CallLanguageLock | null;
  assistantText: string;
  userTurns: string[];
  assistantTurns: string[];
  bookingSaved: boolean;
};

/** English words for a rupee total up to a few crore. */
export function inrToEnglishWords(amount: number): string {
  const n = Math.round(amount);
  if (n < 0) return String(n);
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const one = n % 10;
    return one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten]!;
  }
  if (n < 1000) {
    const rest = n % 100;
    return rest ? `${ONES[Math.floor(n / 100)]} hundred ${inrToEnglishWords(rest)}` : `${ONES[Math.floor(n / 100)]} hundred`;
  }
  if (n < 100_000) {
    const rest = n % 1000;
    return rest
      ? `${inrToEnglishWords(Math.floor(n / 1000))} thousand ${inrToEnglishWords(rest)}`
      : `${inrToEnglishWords(Math.floor(n / 1000))} thousand`;
  }
  if (n < 10_000_000) {
    const rest = n % 100_000;
    return rest
      ? `${inrToEnglishWords(Math.floor(n / 100_000))} lakh ${inrToEnglishWords(rest)}`
      : `${inrToEnglishWords(Math.floor(n / 100_000))} lakh`;
  }
  return String(n);
}

function digitRuns(text: string): string[] {
  return [...text.replace(/,/g, '').matchAll(/\d{6,12}/g)].map((m) => m[0]);
}

function moneyFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(/,/g, '').matchAll(/\b\d{4,8}\b/g) ?? []) {
    const n = Number(m[0]);
    if (n >= 1000 && n < 100_000_000) out.push(n);
  }
  return out;
}

/** Latest mobile-like digit string the caller spoke, if they were giving a number. */
export function latestSpokenPhone(userTurns: string[]): string | null {
  let found: string | null = null;
  for (const turn of userTurns) {
    const runs = digitRuns(turn).filter((d) => /^[6-9]/.test(d) && d.length >= 8 && d.length <= 12);
    if (!runs.length) continue;
    const cued = PHONE_CUE.test(turn);
    if (!cued && !/^\s*[\d\s,+()-]+\s*$/.test(turn)) continue;
    found = runs[runs.length - 1]!;
  }
  return found;
}

export function latestSpokenName(userTurns: string[]): string | null {
  let found: string | null = null;
  for (const turn of userTurns) {
    const m = turn.match(NAME_CUE);
    const name = m?.[1]?.trim();
    if (name && name.length >= 2) found = name.replace(/[.,]$/, '');
  }
  return found;
}

function largestQuoted(assistantTurns: string[]): number | null {
  let best: number | null = null;
  for (const turn of assistantTurns) {
    for (const n of moneyFigures(turn)) {
      if (best === null || n > best) best = n;
    }
  }
  return best;
}

function isTruncatedTotal(quoted: number, heard: number): boolean {
  if (heard >= quoted || heard < 1000) return false;
  const ratio = heard / quoted;
  return ratio > 0.05 && ratio < 0.2;
}

function isOurCorrection(text: string): boolean {
    return /^(Abhi booking save pending|The booking is not saved yet|I heard only \d+ digits|Maine \d+ digit|Before I save this|Save se pehle naam|That is not the same total|Woh total nahi hai|Maaf kijiye, woh andar|Sorry, that was not meant for you|Your booking is saved|Booking save ho chuki hai)/i.test(
    text.trim(),
  );
}

function shortPhoneLine(digits: string, language: CallLanguageLock | null): string {
  const missing = 10 - digits.length;
  if (language === 'hinglish') {
    return `Maine ${digits.length} digit sune. Mobile number 10 digit ka hota hai. Jo ${missing} digit bachi hai, sirf woh boliye.`;
  }
  return `I heard only ${digits.length} digits. A mobile number needs 10 digits. Please say the missing ${missing === 1 ? 'digit' : `${missing} digits`}.`;
}

function nameLine(name: string, language: CallLanguageLock | null): string {
  if (language === 'hinglish') {
    return `Save se pehle naam wapas sun lijiye. Maine suna ${name}. Yeh sahi hai?`;
  }
  return `Before I save this, I need to read the name back. I heard ${name}. Is that right?`;
}

function amountLine(quoted: number, language: CallLanguageLock | null): string {
  const words = inrToEnglishWords(quoted);
  if (language === 'hinglish') {
    return `Woh total nahi hai. Stay ka amount ${words} rupees hai. Chhota figure bill nahi hai.`;
  }
  return `That is not the same total. The stay is ${words} rupees. The shorter figure is not the bill.`;
}

/** Internal procedure speech. A live-lookup name alone is not enough — that fired this on the first city question. */
const TOOL_LEAK_RE =
  /\b(capture_demo_lead|schedule_callback|search_product_knowledge|invoke\s+(?:the\s+)?(?:end_call\s+)?tool|call\s+initiated)\b|\bend_call\b/i;

/**
 * Replacement when the model reads its own tool instructions out loud.
 * Before a booking exists, do not talk about payment links or hanging up.
 */
export function spokenToolLeakLine(
  assistantText: string,
  language: CallLanguageLock | null,
  bookingSaved = false,
): string | null {
  if (!TOOL_LEAK_RE.test(assistantText)) return null;
  if (bookingSaved) {
    return language === 'hinglish'
      ? 'Booking save ho chuki hai. Payment link WhatsApp par aa jayega. Main yahin hoon.'
      : 'Your booking is saved. The payment link will go on WhatsApp. I am still here.';
  }
  return language === 'hinglish'
    ? 'Maaf kijiye, woh andar ki baat thi. Aap bataiye, aage kya chahiye?'
    : 'Sorry, that was not meant for you. What would you like next?';
}

/**
 * Line the worker should speak after an assistant turn, or null to stay quiet.
 * Covers a short mobile, an unread name, a lakh total the caller shortened, and a fake save.
 */
export function spokenIntakeCorrection(input: SpokenIntakeInput): string | null {
  if (input.bookingSaved) return null;
  const assistant = input.assistantText.trim();
  if (!assistant || isOurCorrection(assistant)) return null;

  const phone = latestSpokenPhone(input.userTurns);
  const name = latestSpokenName(input.userTurns);
  const quoted = largestQuoted(input.assistantTurns);
  const userAmount = moneyFigures(input.userTurns.at(-1) ?? '').find((n) => quoted !== null && isTruncatedTotal(quoted, n));
  const bookingClaim = looksLikeBookingConfirmedClaim(assistant);
  const acceptsIntake = ACCEPTS_INTAKE_RE.test(assistant);

  if (quoted !== null && userAmount !== undefined && AGREES_RE.test(assistant) && !moneyFigures(assistant).includes(quoted)) {
    return amountLine(quoted, input.language);
  }

  const pushingSave = bookingClaim || acceptsIntake;
  if (!pushingSave) return null;

  if (phone && phone.length < 10) return shortPhoneLine(phone, input.language);

  if (name && pushingSave) {
    const readBack = input.assistantTurns.some(
      (t) => t.toLowerCase().includes(name.toLowerCase()) && /\?|sahi hai|is that right/i.test(t),
    );
    if (!readBack) return nameLine(name, input.language);
  }

  if (bookingClaim) {
    return input.language === 'en'
      ? 'The booking is not saved yet. Tell me the one detail that is still missing.'
      : 'Abhi booking save pending hai — abhi tak save nahi hui. Jo detail missing hai wo bataiye.';
  }
  return null;
}
