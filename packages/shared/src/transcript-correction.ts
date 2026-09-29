import { isAutomotiveProduct } from './stt-phrase-list.js';

export interface TranscriptCorrectionInput {
  heard: string;
  confidence?: number;
  productName: string;
  knownEmailDomains?: string[];
  recentTurns?: string[];
}

export interface TranscriptCorrectionResult {
  corrected: string;
  needsConfirmation: boolean;
  wasCorrected: boolean;
  likelyIntent?: string;
}

const SKIP_CORRECTION_MIN_CONFIDENCE = 0.85;
const RUN_CORRECTION_MAX_CONFIDENCE = 0.75;
/** Hard cap so a slow OpenAI hop cannot stall the main agent reply. */
const CORRECTION_FETCH_TIMEOUT_MS = 250;

/** VW Virtus phonetics / STT mishears → Virtus (not true competitors like Veloster). */
const VW_VIRTUS_ALIASES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(velocity|velosta|velosty|vertice|virtas|wirtus|virtuas|viritus)\b/gi, replacement: 'Virtus' },
  { pattern: /(वेलोसिटी|वेलोस्टा|वेलोस्टी|वर्टिस|वर्टस)/g, replacement: 'Virtus' },
];

const VW_MODEL_ALIASES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\btake\s+one\s+online\b/gi, replacement: 'Tiguan R-Line' },
  { pattern: /\btake\s+on\s+online\b/gi, replacement: 'Tiguan R-Line' },
  { pattern: /\btake\s+one\s+r[\s-]*line\b/gi, replacement: 'Tiguan R-Line' },
  { pattern: /\btiguan\s+airline\b/gi, replacement: 'Tiguan R-Line' },
  { pattern: /\btiguan\s+air[\s-]*line\b/gi, replacement: 'Tiguan R-Line' },
  { pattern: /\btiguan\s+r[\s-]*line\b/gi, replacement: 'Tiguan R-Line' },
  { pattern: /\b(tycoon|tegun|tygun|tiger gun)\b/gi, replacement: 'Taigun' },
  { pattern: /\b(tyrone|tyron|tayron)\b/gi, replacement: 'Tayron' },
];

const VEHICLE_CONTEXT =
  /\b(sedan|suv|car|cars|model|variant|volkswagen|vw|virtus|taigun|tiguan|dekh|dekha|dekhte|batao|bataiye|price|demo|test\s*drive)\b|एसयूवी|सेडान|कार|देख|बता/i;

const SEDAN_SUV_ASK = /\b(sedan|suv)\b|एसयूवी|सेडान/i;

/**
 * Deterministic product-name STT fixes (runs even at high confidence).
 * Maps Virtus sound-alikes for Volkswagen; leaves true competitor names alone.
 */
export function applyProductNameAliases(heard: string, productName: string): string {
  const product = productName.toLowerCase();
  if (!product.includes('volkswagen') && !product.includes('vw ')) {
    return heard;
  }
  let out = heard;
  for (const { pattern, replacement } of VW_VIRTUS_ALIASES) {
    out = out.replace(pattern, replacement);
  }
  for (const { pattern, replacement } of VW_MODEL_ALIASES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function hasCarContext(heard: string, recentTurns?: string[]): boolean {
  if (VEHICLE_CONTEXT.test(heard)) return true;
  const recent = (recentTurns ?? []).join(' ');
  return SEDAN_SUV_ASK.test(recent) || VEHICLE_CONTEXT.test(recent);
}

function lookingAtSomething(text: string): boolean {
  return /\b(dekh|dekha|dekhte|dekhta|dekhti|looking)\b|देख/i.test(text);
}

/** Strip agent TTS leak: "and maybe", repeated ma'am/माम्. */
export function stripSttEchoFillers(text: string): string {
  let out = text.normalize('NFC').trim();
  out = out.replace(/^(and maybe[,.]?\s+)+/i, '');
  out = out.replace(/((?:माम्|ma'?am+|madam+|mam+|मैम)\s*){2,}/gi, ' ');
  out = out.replace(/\s+(?:माम्|ma'?am+|madam+|mam+|मैम)(?=\s)/gi, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * SUV often misheard as टीवी (TV) or यू पी (UP). Sedan as shutdown / Shahdol.
 * Car mappings run when product is automotive, or (legacy) when product is omitted and context is cars.
 * Skips clear geography ("Uttar Pradesh") without vehicle cues.
 */
export function applySuvSttAliases(
  heard: string,
  recentTurns?: string[],
  productName?: string,
): string {
  let out = stripSttEchoFillers(heard);

  const productKnown = Boolean(productName?.trim());
  const allowCarMaps = !productKnown || isAutomotiveProduct(productName!);
  if (!allowCarMaps) return out;

  out = out.replace(/\bS\s*U\s*V\b/gi, 'SUV');
  out = out.replace(/एस\s*यू\s*वी/g, 'SUV');

  const carCtx = hasCarContext(out, recentTurns);
  const geoOnly =
    /\b(uttar\s*pradesh|up\s+mein\s+reh|up\s+se\s+hoon|state\s+of\s+up)\b|उत्तर\s*प्रदेश/i.test(out) &&
    !/\b(dekh|batao|car|suv|sedan|model)\b|देख|बता/i.test(out);

  if (geoOnly) return out;

  // Sedan mishears even without देख ("main shutdown tha").
  out = out.replace(/\bshut\s*-?\s*downs?\b/gi, 'sedan');
  out = out.replace(/शट\s*डाउन|शटडौन|शटडाउन/g, 'sedan');
  out = out.replace(/\bshahdols?\b/gi, 'sedan');
  out = out.replace(/शहडोल/g, 'sedan');
  out = out.replace(/\bmeshans?\b/gi, 'sedan');
  out = out.replace(/मेशन/g, 'sedan');
  out = out.replace(/आटोमेटिक\s*पहनने/g, 'automatic gearbox');
  out = out.replace(/\bautomatic\s+pehenn[ae]\b/gi, 'automatic gearbox');
  out = out.replace(/\bzomato\s+menu\b/gi, 'automatic manual');
  out = out.replace(/जोमैटो\s*मेन्यु/g, 'automatic manual');

  const looking = lookingAtSomething(out) || carCtx;
  if (looking) {
    out = out.replace(/\b(teevee|t\.?v\.?|tv)\b/gi, 'SUV');
    out = out.replace(/टीवी/g, 'SUV');
    out = out.replace(/\bU\.?\s*P\.?\b/gi, 'SUV');
    out = out.replace(/यू\s*पी/g, 'SUV');
  }

  return out;
}

/** Ask instead of acting when STT is still garbage after aliases. */
export function shouldConfirmUnclearStt(
  text: string,
  opts?: { confidence?: number; needsConfirmation?: boolean },
): boolean {
  if (opts?.needsConfirmation) return true;
  const t = text.normalize('NFC').trim();
  if (!t) return false;
  if (/\b(shutdown|shahdol)\b|शटडाउन|शहडोल/i.test(t)) return true;
  const honorificHits = (t.match(/माम्|ma'?am+|madam|मैम/gi) ?? []).length;
  const withoutHonorific = t.replace(/माम्|ma'?am+|madam|मैम|and maybe/gi, '').trim();
  if (honorificHits >= 2 && withoutHonorific.length < 12) return true;
  return false;
}

export function sttClarifyLine(lastAssistant: string): string {
  if (/\b(sedan|suv)\b|सेडान|एसयूवी/i.test(lastAssistant)) {
    return 'Sedan dekh rahe hain ya SUV? Ek baar confirm kar dijiye.';
  }
  return LOW_CONFIDENCE_REPEAT_PROMPT;
}

function shouldRunCorrection(text: string, confidence?: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  if (confidence == null && /^[\p{L}\p{N}\s.,!?'"-]{1,40}$/u.test(trimmed)) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 6 && !/[0-9@]/.test(trimmed)) return false;
  }
  if (confidence != null && confidence >= SKIP_CORRECTION_MIN_CONFIDENCE) return false;
  if (confidence != null && confidence < RUN_CORRECTION_MAX_CONFIDENCE) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 5 && confidence != null && confidence < 0.82) return true;
  return false;
}

function parseCorrectionJson(
  content: string,
  heard: string,
): TranscriptCorrectionResult | null {
  try {
    const parsed = JSON.parse(content) as {
      corrected?: string;
      needsConfirmation?: boolean;
      likelyIntent?: string;
    };
    const corrected = parsed.corrected?.trim() || heard;
    return {
      corrected,
      needsConfirmation: Boolean(parsed.needsConfirmation),
      wasCorrected: corrected !== heard.trim(),
      likelyIntent: parsed.likelyIntent?.trim(),
    };
  } catch {
    return null;
  }
}

const CORRECTION_SYSTEM = `You fix voice-to-text errors for a CRM sales call. Output JSON only.
Rules:
- Fix obvious STT mishearings using conversation context (homophones, missing letters).
- For Volkswagen: map Virtus sound-alikes (Velocity, Velosta, Vertice, Virtas, Wirtus) to Virtus. Do NOT map Veloster (competitor) to Virtus.
- On car sales / sedan-vs-SUV context: if transcript has टीवी/TV or यू पी/UP plus देख/batao, prefer SUV (not television or Uttar Pradesh).
- Email domains: NEVER rewrite a spoken email domain to a different domain. If Known email domains are listed and STT could match more than one, set needsConfirmation=true and leave the heard domain unchanged.
- Never invent product facts. Never correct grammar or pronunciation — intent only.
- needsConfirmation=true when multiple intents are possible or domain/email is uncertain.
- If the transcript is already clear, return it unchanged with needsConfirmation=false.

Output: {"corrected":"...","needsConfirmation":false,"likelyIntent":"optional short label"}`;

/** Fast LLM pass to fix garbled STT before the main agent reply. */
export async function correctTranscriptForLlm(
  input: TranscriptCorrectionInput,
): Promise<TranscriptCorrectionResult> {
  const heardRaw = input.heard.trim();
  if (!heardRaw) {
    return { corrected: '', needsConfirmation: false, wasCorrected: false };
  }

  let heard = applyProductNameAliases(heardRaw, input.productName);
  heard = applySuvSttAliases(heard, input.recentTurns, input.productName);
  const aliasCorrected = heard !== heardRaw;
  const likelyFromAlias = aliasCorrected
    ? /\bSUV\b/i.test(heard) && !/\bSUV\b/i.test(heardRaw)
      ? 'SUV'
      : /Virtus/i.test(heard)
        ? 'Virtus'
        : /\bsedan\b/i.test(heard) && !/\bsedan\b/i.test(heardRaw)
          ? 'sedan'
          : undefined
    : undefined;

  if (!shouldRunCorrection(heard, input.confidence)) {
    return {
      corrected: heard,
      needsConfirmation: false,
      wasCorrected: aliasCorrected,
      likelyIntent: likelyFromAlias,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      corrected: heard,
      needsConfirmation: false,
      wasCorrected: aliasCorrected,
      likelyIntent: likelyFromAlias,
    };
  }

  const model =
    process.env.OPENAI_FAST_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    'gpt-4o-mini';

  const context = [
    input.recentTurns?.length ? `Recent turns:\n${input.recentTurns.join('\n')}` : '',
    `Product: ${input.productName}`,
    input.knownEmailDomains?.length
      ? `Known email domains: ${input.knownEmailDomains.join(', ')}`
      : '',
    `Heard (STT): ${heard}`,
    input.confidence != null ? `STT confidence: ${input.confidence.toFixed(2)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(CORRECTION_FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CORRECTION_SYSTEM },
          { role: 'user', content: context },
        ],
      }),
    });
    if (!res.ok) {
      return {
        corrected: heard,
        needsConfirmation: false,
        wasCorrected: aliasCorrected,
        likelyIntent: likelyFromAlias,
      };
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      return {
        corrected: heard,
        needsConfirmation: false,
        wasCorrected: aliasCorrected,
        likelyIntent: likelyFromAlias,
      };
    }
    const parsed =
      parseCorrectionJson(content, heard) ?? {
        corrected: heard,
        needsConfirmation: false,
        wasCorrected: false,
      };
    if (aliasCorrected && !parsed.wasCorrected) {
      return {
        ...parsed,
        corrected: heard,
        wasCorrected: true,
        likelyIntent: parsed.likelyIntent || likelyFromAlias,
      };
    }
    return {
      ...parsed,
      wasCorrected: parsed.wasCorrected || aliasCorrected,
      likelyIntent: parsed.likelyIntent || likelyFromAlias,
    };
  } catch {
    return {
      corrected: heard,
      needsConfirmation: false,
      wasCorrected: aliasCorrected,
      likelyIntent: likelyFromAlias,
    };
  }
}

export function buildSttConfidenceNote(confidence: number): string {
  return `[STT note: low confidence (${confidence.toFixed(2)}). Audio may have been unclear. Confirm intent before acting — blame line/audio, not the caller.]`;
}

export const LOW_CONFIDENCE_REPEAT_PROMPT =
  'Sorry, awaaz thodi unclear aayi. Ek baar phir se bol sakte hain?';
