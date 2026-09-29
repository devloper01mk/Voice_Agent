/**
 * Natural spoken clock times for TTS — never leave "H:MM" with a colon
 * (many TTS voices literally say "colon").
 */

export type SpokenTimeLang = 'en' | 'hinglish';

const HOUR_EN = [
  'twelve',
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
] as const;

const HOUR_HI = [
  'barah',
  'ek',
  'do',
  'teen',
  'char',
  'paanch',
  'chhe',
  'saat',
  'aath',
  'nau',
  'das',
  'gyarah',
] as const;

const TEENS_EN = [
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
] as const;

const TENS_EN = ['', '', 'twenty', 'thirty', 'forty', 'fifty'] as const;

const ONES_EN = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
] as const;

function normalizeLang(lang: SpokenTimeLang | 'hi' | 'en' | null | undefined): SpokenTimeLang {
  if (lang === 'hi' || lang === 'hinglish') return 'hinglish';
  return 'en';
}

function hour12From24(hour24: number): number {
  const h = ((hour24 % 24) + 24) % 24;
  return h % 12 === 0 ? 12 : h % 12;
}

function periodFrom24(hour24: number): 'AM' | 'PM' {
  const h = ((hour24 % 24) + 24) % 24;
  return h >= 12 ? 'PM' : 'AM';
}

function minuteWordsEn(minute: number): string {
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  if (m === 0) return '';
  if (m < 10) return `oh ${ONES_EN[m]}`;
  if (m < 20) return TEENS_EN[m - 10]!;
  const tens = TENS_EN[Math.floor(m / 10)]!;
  const ones = ONES_EN[m % 10]!;
  return ones ? `${tens}-${ones}` : tens;
}

/** English: 13:00 → "1 PM"; 13:30 → "one thirty PM"; 13:45 → "one forty-five PM". */
function spokenClockTimeEn(hour24: number, minute: number): string {
  const h12 = hour12From24(hour24);
  const period = periodFrom24(hour24);
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  if (m === 0) return `${h12} ${period}`;
  const hourWord = HOUR_EN[h12 % 12]!;
  return `${hourWord} ${minuteWordsEn(m)} ${period}`;
}

/** Hinglish: 13:00 → "ek baje"; 13:30 → "derh baje"; 14:30 → "dhai baje". */
function spokenClockTimeHi(hour24: number, minute: number): string {
  const h12 = hour12From24(hour24);
  const hourWord = HOUR_HI[h12 % 12]!;
  const m = Math.max(0, Math.min(59, Math.floor(minute)));
  if (m === 0) return `${hourWord} baje`;
  if (m === 30) {
    if (h12 === 1) return 'derh baje';
    if (h12 === 2) return 'dhai baje';
    return `${hourWord} tees`;
  }
  if (m === 15) return `sawa ${hourWord}`;
  if (m === 45) return `${hourWord} paitalees`;
  return `${hourWord} ${m} minute`;
}

/**
 * Speak a 24h clock time in the call language — never includes ":".
 */
export function spokenClockTime(
  hour24: number,
  minute: number,
  lang: SpokenTimeLang | 'hi' | 'en' = 'en',
): string {
  return normalizeLang(lang) === 'hinglish'
    ? spokenClockTimeHi(hour24, minute)
    : spokenClockTimeEn(hour24, minute);
}

function twelveHourTo24(hour12: number, minute: number, mer: string): number {
  let h = hour12 % 12;
  if (/^p/i.test(mer)) h += 12;
  return h;
}

/**
 * Rewrite written clock times in free text for TTS.
 * e.g. "1:00 PM" → "1 PM", "1:30 pm" → "one thirty PM".
 * Also strips a trailing "IST" after rewritten clocks and any leftover digit-colon-digit.
 * Preserves leading/trailing whitespace so streamed TTS chunks do not glue words together.
 */
export function rewriteClockTimesForSpeech(
  text: string,
  lang: SpokenTimeLang | 'hi' | 'en' = 'en',
): string {
  if (!text) return text;
  const speechLang = normalizeLang(lang);
  const leadWs = text.match(/^\s*/)?.[0] ?? '';
  const trailWs = text.match(/\s*$/)?.[0] ?? '';
  let core = text.slice(leadWs.length, text.length - trailWs.length);
  if (!core) return text;

  core = core.replace(
    /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?|am|pm)\b(?:\s*IST)?/gi,
    (_full, hourRaw: string, minuteRaw: string, merRaw: string) => {
      const hour12 = Number(hourRaw);
      const minute = Number(minuteRaw);
      if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return `${hourRaw} ${minuteRaw}`;
      if (!Number.isFinite(minute) || minute < 0 || minute > 59) return `${hourRaw} ${minuteRaw}`;
      const mer = merRaw.replace(/\./g, '');
      const hour24 = twelveHourTo24(hour12, minute, mer);
      return spokenClockTime(hour24, minute, speechLang);
    },
  );

  // Leftover H:MM without am/pm (e.g. mid-stream split) — never leave a colon.
  core = core.replace(/\b(\d{1,2}):(\d{2})\b/g, (_full, hourRaw: string, minuteRaw: string) => {
    const minute = Number(minuteRaw);
    if (minute === 0) return hourRaw;
    return `${hourRaw} ${minuteRaw}`;
  });

  // Stream-safe: any remaining digit-colon must not reach TTS as "colon".
  core = core.replace(/(\d):/g, '$1 ');

  core = core.replace(/\s+/g, ' ').trim();
  return rewriteRahiForSpeech(`${leadWs}${core}${trailWs}`);
}

/**
 * Some TTS voices read Roman "rahi" as English "rah-hee". Spell रही as "rehi"
 * so "bol rahi hoon" sounds like "bol rehi hoon".
 */
export function rewriteRahiForSpeech(text: string): string {
  if (!text) return text;
  return text.replace(/\brahi\b/gi, (match) => {
    if (match === match.toUpperCase()) return 'REHI';
    if (match[0] === match[0].toUpperCase()) return 'Rehi';
    return 'rehi';
  });
}

const HI_NUM_TO_EN: Record<string, string> = {
  sunya: 'zero',
  shunya: 'zero',
  ek: 'one',
  do: 'two',
  teen: 'three',
  char: 'four',
  paanch: 'five',
  panch: 'five',
  chhe: 'six',
  che: 'six',
  saat: 'seven',
  aath: 'eight',
  nau: 'nine',
  das: 'ten',
  gyarah: 'eleven',
  barah: 'twelve',
};

/**
 * When English TTS is locked, rewrite common Roman-Hindi quantity/clock slips
 * so the voice does not say "das" / "do baje". Preserves leading/trailing spaces.
 */
export function rewriteHindiQuantityWordsForEnglishSpeech(text: string): string {
  if (!text) return text;
  const leadWs = text.match(/^\s*/)?.[0] ?? '';
  const trailWs = text.match(/\s*$/)?.[0] ?? '';
  let core = text.slice(leadWs.length, text.length - trailWs.length);
  if (!core) return text;

  // Special half-hour forms first.
  core = core.replace(/\bderh\s+baj(?:e|a)\b/gi, 'one thirty');
  core = core.replace(/\bdhai\s+baj(?:e|a)\b/gi, 'two thirty');
  core = core.replace(/\bsawa\s+(\w+)\b/gi, (_m, hourWord: string) => {
    const en = HI_NUM_TO_EN[hourWord.toLowerCase()];
    return en ? `${en} fifteen` : _m;
  });

  // "das lakh" / "do crore" etc.
  core = core.replace(
    /\b(sunya|shunya|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau|das|gyarah|barah)\s+(lakh|crore|thousand)\b/gi,
    (_m, hi: string, unit: string) => `${HI_NUM_TO_EN[hi.toLowerCase()] ?? hi} ${unit.toLowerCase()}`,
  );

  // "do baje" / "das baja" → English clock
  core = core.replace(
    /\b(sunya|shunya|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau|das|gyarah|barah)\s+baj(?:e|a)\b/gi,
    (_m, hi: string) => {
      const en = HI_NUM_TO_EN[hi.toLowerCase()] ?? hi;
      return `${en} o'clock`;
    },
  );

  // Bare "das" as a quantity word (10) — after compounds so "das lakh" already handled.
  core = core.replace(/\bdas\b/gi, 'ten');

  core = core.replace(/\s+/g, ' ').trim();
  return `${leadWs}${core}${trailWs}`;
}

/**
 * Full English-lock TTS preprocess: clocks then Hindi quantity slips.
 */
export function prepareEnglishLockSpeech(text: string): string {
  return rewriteHindiQuantityWordsForEnglishSpeech(rewriteClockTimesForSpeech(text, 'en'));
}

/**
 * Format an ISO / Date slot start for the agent to read aloud (no colon).
 * e.g. "Tuesday, 4 August at 1 PM"
 */
export function formatSpokenSlotAlternative(
  isoStart: string | Date,
  lang: SpokenTimeLang | 'hi' | 'en' = 'en',
): string {
  const speechLang = normalizeLang(lang);
  const d = typeof isoStart === 'string' ? new Date(isoStart) : isoStart;
  if (Number.isNaN(d.getTime())) {
    return typeof isoStart === 'string' ? rewriteClockTimesForSpeech(isoStart, speechLang) : '';
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const clock = spokenClockTime(hour, minute, speechLang);

  if (speechLang === 'hinglish') {
    return `${day} ${month}, ${weekday} ko ${clock}`;
  }
  return `${weekday}, ${day} ${month} at ${clock}`;
}

/** Join up to N spoken alternatives for tool hints. */
export function formatSpokenSlotAlternatives(
  starts: Array<string | Date | { start: string }>,
  lang: SpokenTimeLang | 'hi' | 'en' = 'en',
  limit = 3,
): string {
  return starts
    .slice(0, limit)
    .map((a) => {
      if (typeof a === 'string' || a instanceof Date) return formatSpokenSlotAlternative(a, lang);
      return formatSpokenSlotAlternative(a.start, lang);
    })
    .filter(Boolean)
    .join('; ');
}
