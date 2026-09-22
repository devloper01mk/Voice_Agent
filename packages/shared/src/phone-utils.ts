const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const SPOKEN_DIGIT_WORD_RE =
  /\b(plus|nine|eight|seven|six|five|four|three|two|one|zero|oh|sunya|shunya|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau)\b/g;

const SPOKEN_DIGIT_WORD_MAP: Record<string, string> = {
  plus: '',
  zero: '0',
  oh: '0',
  sunya: '0',
  shunya: '0',
  one: '1',
  ek: '1',
  two: '2',
  do: '2',
  three: '3',
  teen: '3',
  four: '4',
  char: '4',
  five: '5',
  paanch: '5',
  panch: '5',
  six: '6',
  chhe: '6',
  che: '6',
  seven: '7',
  saat: '7',
  eight: '8',
  aath: '8',
  nine: '9',
  nau: '9',
};

export type PhoneSpeechLocale = 'en' | 'hi';

export type LeadPhoneValidation =
  | { ok: true; phone: string; formatted: string }
  | { ok: false; error: string; hint?: string };

const DEVANAGARI_DIGIT_MAP: Record<string, string> = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

/** Expand spoken digit words / double-triple; leave separators and other chars. */
function expandSpokenDigitWords(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/[०-९]/g, (d) => DEVANAGARI_DIGIT_MAP[d] ?? d);
  // Common Devanagari STT for "eight" / "zero" on Indian calls
  s = s.replace(/एट|आठ/g, '8');
  s = s.replace(/जीरो|शून्य/g, '0');
  s = s.replace(SPOKEN_DIGIT_WORD_RE, (word) => SPOKEN_DIGIT_WORD_MAP[word] ?? word);
  s = s.replace(/double\s+(\d)/g, '$1$1');
  s = s.replace(/triple\s+(\d)/g, '$1$1$1');
  return s;
}

/** True when leftover Latin letters remain after spoken digit-word expansion. */
export function phoneRawContainsLetters(raw: string): boolean {
  return /[a-z]/i.test(expandSpokenDigitWords(raw));
}

/** Strip spoken filler and normalize to digits only. */
export function normalizeSpokenPhone(raw: string): string {
  let s = expandSpokenDigitWords(raw);
  s = s.replace(/\D/g, '');
  if (s.startsWith('91') && s.length === 12) s = s.slice(2);
  if (s.startsWith('0') && s.length === 11) s = s.slice(1);
  return s;
}

const DIGIT_EN: Record<string, string> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

const DIGIT_HI: Record<string, string> = {
  '0': 'sunya',
  '1': 'ek',
  '2': 'do',
  '3': 'teen',
  '4': 'char',
  '5': 'paanch',
  '6': 'chhe',
  '7': 'saat',
  '8': 'aath',
  '9': 'nau',
};

function digitMap(locale: PhoneSpeechLocale): Record<string, string> {
  return locale === 'hi' ? DIGIT_HI : DIGIT_EN;
}

/** Expand digits to spoken words for the given locale (default English). */
export function digitsToWords(digits: string, locale: PhoneSpeechLocale = 'en'): string {
  const map = digitMap(locale);
  return digits
    .replace(/\D/g, '')
    .split('')
    .map((d) => map[d] ?? d)
    .join(' ');
}

/** Expand digits to English words (legacy alias). */
export function digitsToEnglishWords(digits: string): string {
  return digitsToWords(digits, 'en');
}

/**
 * Format phone for spoken read-back as digit words in pairs.
 * English: 9078802278 → "nine zero, seven eight, …"
 * Hindi:   9078802278 → "nau sunya, saat aath, …"
 */
export function formatPhoneForSpeech(
  digits: string,
  locale: PhoneSpeechLocale = 'en',
): string {
  const d = normalizeSpokenPhone(digits);
  if (!d) return '';
  const pairs: string[] = [];
  for (let i = 0; i < d.length; i += 2) {
    const chunk = d.slice(i, i + 2);
    pairs.push(digitsToWords(chunk, locale));
  }
  return pairs.join(', ');
}

export function validateLeadPhone(
  raw: string,
  locale: PhoneSpeechLocale = 'en',
): LeadPhoneValidation {
  if (phoneRawContainsLetters(raw)) {
    return {
      ok: false,
      error: 'Phone contains letters',
      hint: 'Ask for digits only — 10-digit mobile. Do not note or save lettered numbers.',
    };
  }
  const digits = normalizeSpokenPhone(raw);
  if (!digits) {
    return {
      ok: false,
      error: 'Phone number is empty',
      hint: 'Ask them to say the number digit by digit',
    };
  }
  if (digits.length < 10) {
    return {
      ok: false,
      error: 'Phone number too short',
      hint: `Ack the ${digits.length} digits heard in English digit words, then ask only for the remaining ${10 - digits.length} — do not wipe and demand a full re-say`,
    };
  }
  if (digits.length > 10) {
    return {
      ok: false,
      error: 'Phone number too long',
      hint: 'Do not invent a fix — ask which 10 digits are correct (pehle wala vs naya)',
    };
  }
  if (!INDIAN_MOBILE_REGEX.test(digits)) {
    return {
      ok: false,
      error: 'Invalid Indian mobile number',
      hint: 'Indian mobile numbers start with 6, 7, 8, or 9',
    };
  }
  return { ok: true, phone: digits, formatted: formatPhoneForSpeech(digits, locale) };
}
