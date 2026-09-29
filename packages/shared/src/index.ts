import { buildContactConfirmPrompt } from './contact-confirm.js';
import { getIstNowParts } from './call-time.js';
import { simpleExplainSkillLine } from './simple-explain.js';
import { buildSalesSupportSkillsPrompt } from './sales-support-skills.js';
import { assembleSttPhraseList, isAutomotiveProduct, isVolkswagenProduct } from './stt-phrase-list.js';
import {
  type AgentGender,
  type ComplianceConfig,
  type CoreSkillsConfig,
  type LlmProvider,
  type RuntimeConfig,
  type SkillsConfig,
  type SpeakLanguage,
} from './skills-types.js';
import {
  DEFAULT_BOOKING_POLICY,
  mergeBookingPolicy,
  buildBookingPolicyPrompt,
} from './booking-policy.js';
import { lockSpokenHinglishGender } from './hinglish-gender.js';
import { normalizeLeadMemoryRetentionHours } from './lead-memory.js';
import {
  buildProductKnowledgeCatalogMap,
  isLargeProductKnowledge,
  PRODUCT_KNOWLEDGE_SEARCH_TOOL,
} from './product-knowledge.js';
import { resolvePackForBooking } from './packs/index.js';
import { applyPlaybookToBooking, buildPlaybookPrompt, resolvePlaybook } from './playbook.js';

export {
  VERTICAL_PACKS,
  getPack,
  isPackId,
  resolvePackForBooking,
  type PackId,
  type PackTurnInput,
  type VerticalPack,
} from './packs/index.js';

export {
  PLAYBOOK_TEMPLATES,
  PLAYBOOK_LIMITS,
  SALES_PLAYBOOK_HEADING,
  normalizePlaybook,
  getPlaybookTemplate,
  resolvePlaybook,
  applyPlaybookToBooking,
  applyPlaybookToSkills,
  applyPlaybookTemplate,
  buildPlaybookPrompt,
  type SalesPlaybook,
  type PlaybookGoal,
  type PlaybookField,
  type PlaybookDateMode,
  type PlaybookTemplate,
} from './playbook.js';

export {
  PRODUCT_KNOWLEDGE_INLINE_CHARS,
  PRODUCT_KNOWLEDGE_CATALOG_MAP_CHARS,
  PRODUCT_KNOWLEDGE_SEARCH_TOOL,
  PRODUCT_KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
  isLargeProductKnowledge,
  chunkProductKnowledge,
  buildProductKnowledgeCatalogMap,
  tokenizeForSearch,
  keywordScores,
  rankProductKnowledgeChunks,
  formatProductKnowledgeHits,
  type ProductKnowledgeChunkInput,
  type ProductKnowledgeHit,
} from './product-knowledge.js';

export type { AgentGender, ComplianceConfig, CoreSkillsConfig, LlmProvider, RuntimeConfig, SkillsConfig, SpeakLanguage } from './skills-types.js';
export type {
  BookingPolicy,
  BookingPolicyTemplateId,
  BookingOutcome,
  BookingRequiredField,
  BookingDiscussGate,
  BookingLocationType,
  BookingCustomField,
} from './booking-policy.js';
export {
  DEFAULT_BOOKING_POLICY,
  BOOKING_POLICY_TEMPLATES,
  mergeBookingPolicy,
  buildBookingPolicyPrompt,
  buildCaptureDemoLeadToolDescription,
  applyBookingPolicyTemplate,
  missingBookingDiscussGates,
  bookingDiscussGateRejection,
  bookingDiscussGateToolProperties,
  missingCustomFields,
  bookingTypeForOutcome,
  vocabularyForOutcome,
  resolveBookingType,
  bookingSavedConfirmMessage,
  normalizeBookingTypeSlug,
} from './booking-policy.js';

export {
  DEFAULT_REALTIME_VOICE,
  DEFAULT_VOICE_PIPELINE,
  isGeminiLivePipeline,
  isS2sPipeline,
  normalizeVoicePipeline,
  resolveRealtimeVoice,
  type RealtimeVoice,
  type VoicePipeline,
} from './voice-pipeline.js';

export {
  GEMINI_LIVE_VOICE_OPTIONS,
  GEMINI_LIVE_MODEL_OPTIONS,
  GEMINI_LIVE_LANGUAGE_OPTIONS,
  DEFAULT_GEMINI_LIVE_VOICE,
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_LIVE_LANGUAGE,
  FEMALE_GEMINI_LIVE_VOICES,
  GEMINI_31_BRIGHT_VOICES,
  GEMINI_31_WARM_VOICE_HINTS,
  isGeminiLiveVoice,
  isGeminiLiveModel,
  isGemini31LiveModel,
  isGemini38LiveModel,
  isGemini38LiveExtendedThinkingModel,
  isFemaleGeminiLiveVoice,
  resolveGeminiLiveVoice,
  resolveGeminiLiveModel,
  preferGeminiLiveModelForTelephony,
  resolveGeminiLiveLanguageCode,
  geminiLiveThinkingConfig,
  estimateGeminiLiveCostInr,
  buildGeminiLiveS2sInstructionSupplement,
  compressTelephonyS2sInstructions,
  DEFAULT_SPOKEN_TURN_MAX_TOKENS,
  isImmutableGeminiLiveModel,
  resolveLiveKitGeminiModel,
  type GeminiLiveVoice,
  type GeminiLiveModel,
  type GeminiLiveLanguageCode,
  type GeminiLiveVoiceGender,
} from './gemini-live-config.js';

export {
  SIMULATOR_FORCE_S2S_PRESET_ID,
  SIMULATOR_FORCE_S2S_REALTIME,
  REALTIME_S2S_MODEL_OPTIONS,
  REALTIME_S2S_TRANSCRIPTION_OPTIONS,
  REALTIME_S2S_NOISE_REDUCTION_OPTIONS,
  REALTIME_S2S_TURN_MODE_OPTIONS,
  REALTIME_S2S_EAGERNESS_OPTIONS,
  REALTIME_S2S_TRANSCRIPTION_PROMPT,
  defaultRealtimeS2sUserConfig,
  defaultGeminiLiveS2sUserConfig,
  normalizeRealtimeS2sUserConfig,
  resolveS2sProvider,
  realtimeS2sUserConfigToSessionConfig,
  estimateRealtimeS2sCostInr,
  buildRealtimeS2sSessionConfig,
  isRealtimeS2sPresetId,
  type RealtimeS2sPresetId,
  type RealtimeS2sSessionConfig,
  type RealtimeS2sTurnDetectionConfig,
  type RealtimeS2sUserConfig,
  type RealtimeS2sNoiseReduction,
  type RealtimeS2sTurnMode,
  type RealtimeS2sEagerness,
  type RealtimeS2sMaxTokensMode,
  type S2sProvider,
} from './realtime-s2s-config.js';

export const DEFAULT_VOICE_LANGUAGES: SpeakLanguage[] = ['en', 'hi', 'hinglish'];

export function parseVoiceLanguages(raw?: string | null): SpeakLanguage[] {
  if (!raw?.trim()) return [...DEFAULT_VOICE_LANGUAGES];
  const langs = raw.split(',').map((s) => s.trim().toLowerCase());
  const valid = langs.filter(
    (l): l is SpeakLanguage => l === 'en' || l === 'hi' || l === 'hinglish',
  );
  return valid.length ? valid : [...DEFAULT_VOICE_LANGUAGES];
}

export function serializeVoiceLanguages(languages: SpeakLanguage[]): string {
  return languages.join(',');
}

export function defaultTtsLanguage(languages: SpeakLanguage[]): string {
  if (languages.length === 1) {
    return languages[0] === 'en' ? 'en' : 'hi';
  }
  if (languages.includes('hinglish') || languages.includes('hi')) return 'hi';
  return 'en';
}

const HINGLISH_WORD =
  /\b(haan|haanji|nahi|nahin|kya|aap|apka|apke|hai|hain|main|mujhe|chahiye|theek|thik|acha|accha|ji|kaise|kab|kyun|bahut|abhi|bas|suniye|batao|bataiye|samajh|dekho|zaroor|shayad|bilkul|thoda)\b/i;

export function detectTtsLanguage(text: string, languages: SpeakLanguage[]): string {
  if (languages.length === 1) return defaultTtsLanguage(languages);
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  const words = text.trim().split(/\s+/).filter(Boolean);
  const hinglishHits = words.filter((w) => HINGLISH_WORD.test(w)).length;
  const latinOnly = /^[\x00-\x7F\s.,!?'"-]+$/.test(text);
  if (hinglishHits > 0 && (languages.includes('hinglish') || languages.includes('hi'))) {
    return 'hi';
  }
  if (latinOnly && hinglishHits === 0 && languages.includes('en')) return 'en';
  return defaultTtsLanguage(languages);
}

const LANGUAGE_SECTION_RE = /## Language[^\n]*\n[\s\S]*?(?=\n## )/;

function buildLanguagePrompt(languages: SpeakLanguage[]): string {
  const polishRules = `- Match the caller's tone and formality — polished but not stiffer than they are.
- If the caller is casual, you may be warm and slightly informal while staying professional.
- If the caller is formal, stay respectful and structured.`;

  if (languages.length === 1 && languages[0] === 'en') {
    return `## Language
- Speak only in English.
${polishRules}\n`;
  }

  const hasEnglish = languages.includes('en');
  const hasHindiOrHinglish = languages.includes('hi') || languages.includes('hinglish');
  const speakLine = hasEnglish && hasHindiOrHinglish
    ? '- You speak **English** and **polished Hinglish** (Roman/Latin script). You do **NOT** speak pure Hindi or Devanagari.'
    : hasHindiOrHinglish
      ? '- Speak **polished Hinglish** in Roman/Latin script only. Never pure Hindi or Devanagari.'
      : '- Speak only in English.';

  return `## Language (critical)
${speakLine}
${polishRules}
- **Match the caller's language (sticky for the call — not last-turn only):**
  - Detect language from **recent caller turns / dominant call language**, not from one mixed or garbled utterance.
  - English caller (clear full English turns) → reply in polished English.
  - Hindi caller (Devanagari or spoken Hindi) → reply in **polished Hinglish** (Roman/Latin script only). Never use Devanagari script, even when the caller speaks pure Hindi.
  - Hinglish caller (Roman Hindi-English mix) → reply in polished Hinglish (Roman script).
- **EXPLICIT LANGUAGE LOCK (highest priority):**
  - If the caller says "talk in English" / "can we speak English" / similar → **lock to English** for the rest of the call.
  - While English-locked: reply in polished English **every turn** — even if their next turns are Hindi, Hinglish, Devanagari STT, or mixed garbled speech. Do NOT flip back to Hinglish.
  - Unlock / switch to Hinglish **only** after an explicit request ("talk in Hindi", "hindi mein baat karo", etc.).
  - Same rule in reverse: explicit Hindi/Hinglish request locks Hinglish until they ask for English.
- **Sticky Hinglish (only when NOT English-locked):** If recent caller turns were Hindi or Hinglish and there is no English lock, keep Roman Hinglish — even if the latest turn has English product words or mixed STT.
- **Switch to English without lock only after** a clear, full English caller turn sustained without Hindi/Hinglish. Prefer treating "can we talk in English" as a hard lock (above).
- Never reply in pure English mid-Hinglish call (when not English-locked) just because Product Knowledge is written in English — always generate the spoken line yourself in Roman Hinglish.
- Generate new wording every turn. Never copy the same English or Hinglish sentence.
- Polished Hinglish = natural Hindi-English mix in Roman script, professional sales tone. Mix in common English words from Product Knowledge (price, booking, call, email, schedule) — do not invent product jargon.
- **No Urdu vocabulary.** Speak everyday Hindi + English only. Never Urdu-leaning words such as: alvida, shukriya, mazeed, inshaallah, khuda hafiz, allah hafiz. Prefer: "bye" / "goodbye" / "phir milte hain", "dhanyavaad" / "thank you", "aur" / "zyada", "is ke baare mein aur bataun?", "sunna chahenge?".
- **BAD (Urdu):** "Dhanyavaad, alvida." / "Is category ke baare mein mazeed janna chahte hain?"
- **GOOD:** "Dhanyavaad, bye!" / "Is room ke baare mein aur sunna chahenge?" / "Price ya facilities mein se kya pehle bataun?"
- **BAD (never):** pure Hindi or Devanagari — e.g. "मैं आपकी मदद कर सकती हूँ" or "Main aapki sahayata kar sakti hoon. Kya main aapko vivaran de sakti hoon?"
- **BAD (after English lock):** any Hinglish reply like "Aapka budget ten lakh…" — stay in English: "Your budget is around ten lakh…"
- **BAD (mid-Hinglish call, no English lock):** a full reply in pure English after the caller has been speaking Hindi/Hinglish.
- **GOOD (say, only when they already want a next step):** "Jab aap ready hon, main next step help kar sakti hoon. Kal subah theek rahega?"
- **BAD:** Ending every answer with "booking start karein?" / "details collect karun?" when they only asked for info.
- **Times, prices vs identifier digits (critical):**
  - **Price / amount / time / weight / height / age** match reply language as natural magnitude (not digit-by-digit): English → "two o'clock" / "1 PM" / "ten lakh" / "nine hundred fifty" / "forty-five" (kg); Hinglish → "do baje" / "das lakh" / "nau sau pachas" / "paintalis". Never say weight 45 as "four five".
  - **English lock / English call:** never Hindi quantity or clock words ("das", "do baje", "das lakh", "das baje") — say "ten", "two o'clock", "ten lakh", "forty-five". Never say "das" for 10.
  - **Never write clock times with a colon when speaking** (forbidden: "1:00 PM", "1:30 PM", saying "colon"). English: "1 PM", "one thirty PM", "twelve PM". Hinglish: "ek baje", "derh baje", "barah baje".
  - **Phone, OTP, PIN** (and email digits if ever spoken) → ALWAYS English digit words one-by-one or in pairs ("one nine three four", "two two"), even on a Hinglish call. Never "nau sau", "nineteen thirty four", Hindi digit names, or "double"/"triple" ("double two" is forbidden — say "two two").
  - When understanding the caller: price/amount/weight/height/age = natural Hindi or English; phone/OTP/PIN = digit sequence.
- Keep responses short and natural for speech.\n`;
}

/** Refresh language rules at call time so stored prompts pick up updated Hinglish policy. */
export function refreshLanguagePrompt(
  compiledSystemPrompt: string,
  voiceLanguages?: string | null,
): string {
  const languages = parseVoiceLanguages(voiceLanguages);
  const fresh = buildLanguagePrompt(languages).trimEnd();
  if (LANGUAGE_SECTION_RE.test(compiledSystemPrompt)) {
    return compiledSystemPrompt.replace(LANGUAGE_SECTION_RE, fresh);
  }
  const personaMatch = compiledSystemPrompt.match(/^Persona:.*\n\n/m);
  if (personaMatch?.index !== undefined) {
    const insertAt = personaMatch.index + personaMatch[0].length;
    return (
      compiledSystemPrompt.slice(0, insertAt) +
      fresh +
      '\n\n' +
      compiledSystemPrompt.slice(insertAt)
    );
  }
  return `${compiledSystemPrompt}\n\n${fresh}`;
}

export function buildGenderPrompt(gender: AgentGender, languages: SpeakLanguage[]): string {
  const needsHindiGrammar =
    languages.includes('hi') || languages.includes('hinglish');
  if (!needsHindiGrammar) {
    return `## Speaker gender
- You speak as a ${gender} agent. Use natural first-person wording in English.\n`;
  }

  if (gender === 'female') {
    return `## Speaker gender (critical for polished Hinglish)
- You are a **female** speaker. Every polished Hinglish reply MUST use **feminine** first-person verb forms in Roman script.
- Present / continuous: karti hoon, bol rehi hoon, bata rehi hoon, chahati hoon, samjha rehi hoon, dikha rehi hoon — **never** karta hoon, bol raha hoon, karunga, bataunga.
- Spell feminine continuous as **rehi**, never **rahi** (TTS: "Neha bol rehi hoon", not "bol rahi hoon").
- Past tense: samajh gayi, kar di, bata di, dekh li — **never** samajh gaya, kar diya, bata diya, dekh liya.
- Ability / modal: kar sakti hoon, karungi, chahungi — **never** kar sakta hoon, karunga, chahunga.
- Examples: "Main samajh gayi", "Main aapko bata rehi hoon".
- English replies have no gendered verbs; stay natural as a female sales agent.\n`;
  }

  return `## Speaker gender (critical for polished Hinglish)
- You are a **male** speaker. Every polished Hinglish reply MUST use **masculine** first-person verb forms in Roman script.
- Present / continuous: karta hoon, bol raha hoon, bata raha hoon — **never** karti hoon, bol rahi hoon.
- Past tense: samajh gaya, kar diya, bata diya — **never** samajh gayi, kar di, bata di.
- Ability / modal: kar sakta hoon, karunga — **never** kar sakti hoon, karungi.
- English replies have no gendered verbs; stay natural as a male sales agent.\n`;
}

/** Append gender rules at call time when the stored prompt predates gender compilation. */
export function ensureGenderPrompt(
  compiledSystemPrompt: string,
  agentGender: AgentGender | string | undefined,
  voiceLanguages?: string | null,
): string {
  if (compiledSystemPrompt.includes('## Speaker gender')) {
    return compiledSystemPrompt;
  }
  const gender: AgentGender = agentGender === 'male' ? 'male' : 'female';
  const languages = parseVoiceLanguages(voiceLanguages);
  return `${compiledSystemPrompt}\n\n${buildGenderPrompt(gender, languages)}`;
}

export {
  appendHinglishGenderLock,
  buildHinglishGenderCorrectionNote,
  buildHinglishGenderLockPrompt,
  lockSpokenHinglishGender,
  normalizeAgentGender,
  spokenUsesWrongHinglishGender,
} from './hinglish-gender.js';

export {
  inferCallerGender,
  genderFromGivenName,
  genderFromFirstPersonVerbs,
  buildCallerGenderSystemNote,
  buildCallerGenderPromptLine,
  type CallerGender,
} from './caller-gender.js';

export const DEFAULT_CORE_SKILLS: CoreSkillsConfig = {
  dnc: {
    confirmLine:
      'Theek hai — aapko dubara call nahi karenge. Dhanyavaad.',
  },
  wrongNumber: {
    apologizeLine:
      'Maaf kijiye agar galat number par call ho gaya. Main ab disconnect kar rehi hoon.',
  },
  gatekeeper: {
    askScript:
      'Kya main {decision_maker} se baat kar sakti hoon? Ya unke liye short message chhod sakti hoon.',
    callbackOffer:
      'Kab convenient hoga jab woh available hon? Main callback schedule kar deti hoon.',
  },
  identity: {
    whoIsCalling:
      'Main {agent_name} bol rehi hoon, {product_name} se — aapki enquiry pe follow-up call kiya tha, taaki sahi option choose kar sakein.',
  },
  privacy: {
    leadSourceAnswer:
      'Aapke enquiry, website form, ya partner list se contact mila tha — company policy ke hisaab se.',
    recordingObjection:
      'Samajh sakti hoon. Agar aap comfortable nahi hain to hum call yahin end kar sakte hain ya baad mein email par details bhej sakte hain.',
  },
  humanHandoff: {
    acknowledge:
      'Bilkul — main aapko human agent se connect karwane ki koshish karti hoon. Best contact number confirm kar dijiye.',
  },
  detailsChannel: {
    sendDetailsPromise:
      'Ji, main details WhatsApp ya email par bhej dungi — kaunsa prefer karenge? Number/email confirm kar lete hain.',
  },
  abusive: {
    boundaryLine:
      'Main madad karna chahti hoon lekin respectful conversation zaroori hai. Agar aap chahein to baad mein call kar sakte hain.',
  },
  silence: {
    checkInLine: 'Hello, kya meri awaaz aa rehi hai?',
    goodbyeLine: 'Lagta hai line quiet hai — main disconnect kar rehi hoon. Dhanyavaad.',
  },
  audioIssue: {
    checkLine: 'Kya aap meri awaaz sun pa rahe hain?',
    callbackOffer:
      'Shayad line issue hai — main baad mein callback kar deti hoon. Kab convenient rahega?',
  },
  voicemail: {
    messageScript:
      'Namaste, main {agent_name} bol rehi hoon {product_name} se. Aap free hon to callback kar lijiye. Dhanyavaad.',
  },
  ivr: {
    receptionistScript:
      'Namaste, kya main {decision_maker} se connect ho sakti hoon? Ya unke liye short message chhod sakti hoon.',
  },
};

export const DEFAULT_COMPLIANCE: ComplianceConfig = {
  recordingDisclosure:
    'Yeh call quality aur training ke liye record ho sakti hai — agar aapko issue ho to bata dijiye.',
};

export const DEFAULT_RUNTIME: RuntimeConfig = {
  holdAckLine: 'Ji.',
  exploringSilenceMs: 5_000,
  holdSoftCheckinMs: 70_000,
  silenceFirstPromptSec: 15,
  silenceEndSec: 45,
  leadMemoryRetentionHours: 48,
};

export const DEFAULT_SKILLS: SkillsConfig = {
  angry: {
    acknowledge:
      'Samajh sakti hoon — yeh frustrating lag raha hai, aur main iske liye sorry hoon.',
    deescalate:
      'Main simple rakhti hoon aur pehle aapki zarurat fix karti hoon — koi pitch nahi jab tak aap ready na hon.',
  },
  busy: {
    acknowledge: 'Bilkul — abhi sahi time nahi lag raha.',
    callbackQuestion: 'Main kab callback karun — aaj baad mein ya kal subah?',
    confirmTemplate:
      'Theek hai — {preferred_time} note kar liya. Hum tab call karenge. Dhanyavaad!',
  },
  support: {
    acknowledge:
      'Maaf kijiye aapko yeh issue face karna pad raha hai — main sahi madad tak le jaati hoon.',
    collectContact:
      'Support team ke liye best email ya phone number kya rahega?',
    handoffPromise:
      'Note kar liya — support team ek business day ke andar follow-up karegi.',
  },
  objection: {
    empathyLine: 'Samajh sakti hoon — yeh sochna bilkul normal hai.',
    priceResponse:
      'Budget important hai. Product Knowledge ke hisaab se jo fit ho sakta hai woh bataungi. Aapka budget roughly kitna hai?',
    excelResponse:
      'Jo aap abhi use kar rahe ho woh theek hai. Upgrade tab helpful hota hai jab better experience chahiye. Aap kya improve karna chahte hain?',
    thinkItOverResponse:
      'Bilkul — carefully decide kijiye. Jab ready hon, short next step se clarity mil jaati hai. Kab convenient rahega?',
  },
  discovery: {
    openQuestion: 'Sahi option batane ke liye — aap kya dekh rahe hain?',
    painProbe:
      'Aapke liye sabse important kya hai — features, price, ease, location, ya kuch aur?',
    currentToolsQuestion: 'Abhi kya use kar rahe hain, ya pehli baar dekh rahe hain?',
  },
  competitor: {
    boundaryTemplate:
      'Main {product_name} ko fair compare karke bata sakti hoon — jo typical strengths hain us hisaab se.',
    pivotQuestion:
      'Aapke liye zyada matter kya karta hai — features, price, ya overall fit?',
    demoBridge:
      'Agar clear dekhna ho to short next step help karta hai — is hafte try karna theek rahega?',
  },
  exit: {
    notInterestedLine:
      'Koi baat nahi — abhi shayad sahi fit nahi lag raha.',
    politeClose: 'Kabhi zarurat ho to hum yahin hain. Time ke liye dhanyavaad — take care!',
  },
  demoOfferScript:
    'Jo aapne bataya uske hisaab se short next step se choice clear ho jaati hai. Help karun schedule karne mein?',
  demo: {
    nameConfirmTemplate: 'Maine suna {name} — yeh sahi hai?',
    nameSpellRetryTemplate:
      'Koi baat nahi — naam ek baar clearly boliye, ya letter by letter spell kar dijiye.',
    phoneConfirmTemplate:
      'Maine suna {phone} — yeh number sahi hai?',
    phoneSpellRetryTemplate:
      'Digit by digit English mein boliye — zero one two — main confirm kar lungi.',
    knownEmailDomains: ['cronberry.com', 'marruji.com', 'kiit.ac.in'],
  },
  unclear: {
    lineUnclearTemplate:
      'Main samajhna chahti hoon — aap kis product option ya feature ke baare mein jaanna chahte hain?',
    intentConfirmTemplate:
      'Ek baar confirm kar doon — aap features jaanna chahte hain, price, ya demo?',
  },
  offTopic: {
    /** Intent only — LLM must paraphrase each turn; never treat as a fixed script. */
    refusalTemplate:
      'Politely decline that topic; you help with {product_name} recommendations, pricing, comparison, and demos.',
    personalRefusalTemplate:
      'Firmly but politely decline personal chat, dates, or romance; you only help with {product_name}.',
    redirectQuestion:
      'Ask if they want a model recommendation, pricing, comparison, or a demo.',
    /** After this many short redirects, polite goodbye + end_call. */
    maxRedirects: 5,
  },
  timepass: {
    maxCasualTurns: 5,
    /** Intent for LLM redirects; paraphrase each turn. */
    redirectLine:
      'Briefly steer back to choosing the right {product_name} option.',
    /**
     * Used as LLM goodbye intent AND as last-resort spoken line when wrap forces end_call
     * (must stay speakable Roman Hinglish — not English-only).
     */
    exitLine:
      'Koi baat nahi — jab {product_name} discuss karna ho, call kar lijiye. Dhanyavaad!',
  },
  core: { ...DEFAULT_CORE_SKILLS },
  compliance: { ...DEFAULT_COMPLIANCE },
  runtime: { ...DEFAULT_RUNTIME },
  booking: { ...DEFAULT_BOOKING_POLICY, requiredFields: [...DEFAULT_BOOKING_POLICY.requiredFields] },
};

/** Merge stored skills with defaults so new playbooks apply to older agents. */
export function mergeSkillsConfig(partial?: Partial<SkillsConfig> | null): SkillsConfig {
  if (!partial) return structuredClone(DEFAULT_SKILLS);
  const baseCore = { ...DEFAULT_CORE_SKILLS, ...partial.core };
  return {
    ...DEFAULT_SKILLS,
    ...partial,
    angry: { ...DEFAULT_SKILLS.angry, ...partial.angry },
    busy: { ...DEFAULT_SKILLS.busy, ...partial.busy },
    support: { ...DEFAULT_SKILLS.support, ...partial.support },
    objection: { ...DEFAULT_SKILLS.objection, ...partial.objection },
    discovery: { ...DEFAULT_SKILLS.discovery, ...partial.discovery },
    competitor: { ...DEFAULT_SKILLS.competitor, ...partial.competitor },
    exit: { ...DEFAULT_SKILLS.exit, ...partial.exit },
    demo: { ...DEFAULT_SKILLS.demo!, ...partial.demo } as SkillsConfig['demo'],
    unclear: { ...DEFAULT_SKILLS.unclear, ...partial.unclear },
    offTopic: { ...DEFAULT_SKILLS.offTopic, ...partial.offTopic },
    timepass: { ...DEFAULT_SKILLS.timepass, ...partial.timepass },
    core: {
      ...baseCore,
      dnc: { ...DEFAULT_CORE_SKILLS.dnc, ...partial.core?.dnc },
      wrongNumber: { ...DEFAULT_CORE_SKILLS.wrongNumber, ...partial.core?.wrongNumber },
      gatekeeper: { ...DEFAULT_CORE_SKILLS.gatekeeper, ...partial.core?.gatekeeper },
      identity: { ...DEFAULT_CORE_SKILLS.identity, ...partial.core?.identity },
      privacy: { ...DEFAULT_CORE_SKILLS.privacy, ...partial.core?.privacy },
      humanHandoff: { ...DEFAULT_CORE_SKILLS.humanHandoff, ...partial.core?.humanHandoff },
      detailsChannel: { ...DEFAULT_CORE_SKILLS.detailsChannel, ...partial.core?.detailsChannel },
      abusive: { ...DEFAULT_CORE_SKILLS.abusive, ...partial.core?.abusive },
      silence: { ...DEFAULT_CORE_SKILLS.silence, ...partial.core?.silence },
      audioIssue: { ...DEFAULT_CORE_SKILLS.audioIssue, ...partial.core?.audioIssue },
      voicemail: { ...DEFAULT_CORE_SKILLS.voicemail, ...partial.core?.voicemail },
      ivr: { ...DEFAULT_CORE_SKILLS.ivr, ...partial.core?.ivr },
    },
    compliance: { ...DEFAULT_COMPLIANCE, ...partial.compliance },
    runtime: {
      ...DEFAULT_RUNTIME,
      ...partial.runtime,
      leadMemoryRetentionHours: normalizeLeadMemoryRetentionHours(
        partial.runtime?.leadMemoryRetentionHours ?? DEFAULT_RUNTIME.leadMemoryRetentionHours,
      ),
    },
    booking: mergeBookingPolicy(partial.booking ?? DEFAULT_BOOKING_POLICY),
  };
}

export interface AgentInput {
  name: string;
  greeting: string;
  persona: string;
  productName: string;
  voiceId: string;
  voiceLanguages?: string;
  voiceSpeed: number;
  agentGender?: AgentGender;
  llmProvider: LlmProvider;
  llmModel: string;
  brainMarkdown: string;
  /** LLM-compressed knowledge used in calls; falls back to brainMarkdown when empty. */
  brainSummary?: string;
  /**
   * When true: fill gaps (own product or competitors) with LLM general knowledge;
   * recommend the best-fit offering from Product Knowledge by caller need (do not lock one SKU).
   * When false: answer only from Product Knowledge / prompt — no LLM fill outside it.
   */
  generalKnowledgeEnabled?: boolean;
  /** Client's short always-on guardrails (never searched, never summarized). */
  agentRules?: string;
  /** Stored Sales playbook JSON (how to sell). Null → derived from Booking policy + template. */
  playbook?: unknown;
  skillsConfig: SkillsConfig;
}

export const AGENT_RULES_MAX_CHARS = 1_500;

function buildAgentRulesPrompt(raw?: string | null): string {
  const rules = raw?.trim().slice(0, AGENT_RULES_MAX_CHARS).trim();
  if (!rules) return '';
  return `## Agent rules (always follow — override everything below except safety)\n${rules}`;
}

export function productKnowledgeForPrompt(agent: Pick<AgentInput, 'brainMarkdown' | 'brainSummary'>): string {
  const summary = agent.brainSummary?.trim();
  const full = summary || agent.brainMarkdown;
  if (!isLargeProductKnowledge(full)) return full;
  return `- **This is only a map of a larger catalog.** For any price, plan, feature, policy, FAQ, or location detail not written below, call **${PRODUCT_KNOWLEDGE_SEARCH_TOOL}** silently, then answer only from its facts. Never guess missing details.

${buildProductKnowledgeCatalogMap(agent.brainMarkdown, summary)}`;
}

/** Last-resort safety copy is stored feminine; inflect first-person verbs for male agents. */
export function inflectSafetyCopy(text: string, gender: AgentGender): string {
  let out = text;
  if (gender === 'male') {
    out = out
      .replaceAll('bol rehi hoon', 'bol raha hoon')
      .replaceAll('kar rehi hoon', 'kar raha hoon')
      .replaceAll('aa rehi hai', 'aa rahi hai')
      .replaceAll('chhod sakti hoon', 'chhod sakta hoon')
      .replaceAll('connect ho sakti hoon', 'connect ho sakta hoon')
      .replaceAll('kar sakti hoon', 'kar sakta hoon')
      .replaceAll('samajh sakti hoon', 'samajh sakta hoon')
      .replaceAll('chahti hoon', 'chahta hoon')
      .replaceAll('karti hoon', 'karta hoon')
      .replaceAll('kar deti hoon', 'kar deta hoon')
      .replaceAll('bhej dungi', 'bhej dunga')
      .replaceAll('kar lungi', 'kar lunga')
      .replaceAll('{agent_name} bol rehi hoon', '{agent_name} bol raha hoon');
  }
  return lockSpokenHinglishGender(out, gender);
}

function fillSafetyPlaceholders(
  template: string,
  productName: string,
  agentName: string,
): string {
  return template.replaceAll('{product_name}', productName).replaceAll('{agent_name}', agentName);
}

function buildKnowledgeModePrompt(productName: string, generalKnowledgeEnabled: boolean): string {
  if (generalKnowledgeEnabled) {
    return `## Knowledge mode: GENERAL KNOWLEDGE ON
- Always prefer Product Knowledge for ${productName} facts when present. Never contradict Product Knowledge.
- If Product Knowledge is missing details about ${productName} itself OR about competitors/related offerings, you MAY use your general knowledge to answer helpfully (mark prices as approximate when unsure).
- Stay positive; keep the main focus on selling ${productName} (the brand/catalog), not one fixed SKU.
- Recommend the best-fit offering from Product Knowledge based on the caller's stated needs. Do not lock onto one item or push the first catalog entry every turn.
- If the caller switches offerings, stay on what they asked about until they change topic.
- Never invent live offers, financing amounts, discounts, or unpublished prices as confirmed quotes.`;
  }

  return `## Knowledge mode: PROMPT ONLY (GENERAL KNOWLEDGE OFF)
- Answer ONLY from Product Knowledge in this prompt. Use the complete product information provided there.
- Do NOT use general knowledge to fill gaps about ${productName}, competitors, or any other topic.
- If the caller asks something not covered in Product Knowledge, say briefly that you only have verified details from your product knowledge, then continue helping from listed offerings.
- Never invent prices, specs, or competitor facts that are not in Product Knowledge.
- Recommend by caller need from listed offerings; do not lock onto one item.`;
}

/**
 * Product-agnostic salesperson behaviour — same for every industry and catalog.
 * Facts come from Product Knowledge / tools; this only defines *how* to sell.
 */
function buildConsultativeSalesProcessPrompt(productName: string): string {
  return `## Consultative sales + support process (any product)
You are a **sales and support advisor**, not a booking clerk. Behaviour is the same for every product; only facts change via **Product Knowledge / Brain** and live tools for ${productName}.

**Every reply uses two sources:**
- **Brain / Product Knowledge** → what is true (prices, facilities, policies, locations).
- **Sales & support skills** → how to listen, answer, de-escalate, and when to close.

Follow this order — **do not skip ahead**:
1. **Rapport + purpose** — who you are, why you called / how you can help (short).
2. **Discover** — need, use-case, timing, constraints. Ask **one** question per turn. Do not fire a form.
3. **Value / features first** — from Product Knowledge, explain what fits and **why**. Teach; do not dump a full SKU/price menu on a yes/no existence ask.
4. **Invite their ask** — if unclear, one soft line about what they want next — then wait. Prefer "aur kya jaanna hai?" over booking.
5. **Quote / live options** — prices, rates, and discounts only when they ask kitna, rate, price, budget, discount, or mehnga. A location or feature answer has no number.
6. **Soft close** — only on **clear buy/book/demo/visit intent** (book, reserve, le lunga, confirm). Never early "Kya main booking / demo arrange kar doon?" / "booking process start karein?" / "details collect karun?".
7. **Capture** — collect only **missing** Booking-policy fields → save tool → say confirmed **only** after ok:true.

**Forbidden until they ask or show clear close intent:**
- Unsolicited full price list / SKU menu
- Pushing booking / "shall I book / arrange / confirm for you?" / "booking start"
- Inventing their dates, party size, name, or preferences
- Saying anything is booked/confirmed without tool ok:true (including "booking confirm ho jayegi")
- Inventing live availability, stock, prices, addresses, landmarks, distances, or policies not returned by a live tool or written in Product Knowledge. If it is missing, say you will check — never guess, and never promise it on WhatsApp.

**Every turn:** answer **only** what they just asked (1–2 sentences) → at most **one** next question. Match their language. Answer objections on the **exact** topic asked — do not jump to booking.`;
}

function buildPrinciplesPrompt(
  skills: SkillsConfig,
  productName: string,
  agentName: string,
  gender: AgentGender,
  generalKnowledgeEnabled: boolean,
): string {
  const core = mergeSkillsConfig(skills).core ?? DEFAULT_CORE_SKILLS;
  const compliance = skills.compliance ?? DEFAULT_COMPLIANCE;
  const runtime = skills.runtime ?? DEFAULT_RUNTIME;
  const maxRedirects = Math.max(1, skills.offTopic.maxRedirects);
  const pack = resolvePackForBooking(skills.booking);
  const line = (raw: string) =>
    inflectSafetyCopy(fillSafetyPlaceholders(raw, productName, agentName), gender);

  return `## How to understand the caller
- Infer meaning from **this call's history + the latest utterance**. There is no fixed list of intents you must match, and no numeric confidence score.
- **Unseen asks are valid.** Help using Product Knowledge, tools, and these principles. Do not refuse because the topic is not named here. Handling a new ask does not require a new category.
- Generate **new wording every turn**. Never copy a previous sentence or a template.
- ${simpleExplainSkillLine()}
- Sound like an experienced advisor for ${productName}: calm, consultative, never pushy. Teach from Product Knowledge — do not recite catalog labels.
- Default: 1–2 short spoken sentences. Comparison turns may use one medium spoken reply. After a useful answer, you may stop with no new question.
- **Latest ask first:** Answer only what the caller just asked or corrected. Do not tack on payment, advance, deposit, booking pitch, or a second agenda item in the same turn unless they asked for it.
- **Product questions first:** If they ask about location, offerings, features, price, or availability facts in Product Knowledge (or live inventory tools when available) — answer that **now**. Never withhold the answer until they give name, phone, WhatsApp, or payment ack. Contact fields come only when they are ready to book/save.
- **No intake funnel lock:** Do not reply to a product question with "pehle naam/number/dates chahiye". If dates/party size are already known this call, do not re-ask them to dodge the question.
- **Topic switch / correction:** If they change topic, correct dates, or say "meri baat suno" / "aisa nahi" / "pehle jawab do", drop the previous checklist. Confirm the correction or answer the question in one short reply — no payment or upsell tagline.
- **Dates:** Resolve relative weeks/days via **Call time (IST)**. On a date-correction turn for booking/save, confirm dates only — do not mix payment.
- Social greetings ("kaise ho" / "how are you") are rapport, not a refusal topic: answer warmly, ask back once, do not pitch that turn.
- Do not chain intake questions. After they share a preference, react and help from Product Knowledge rather than firing the next form field.
- Never repeat a price, plan, or catalog recap already spoken this call. "Tell me more" → one new useful point, not a recap.
- Choosing a listed offering is interest, not a goodbye — continue helping. NEVER end_call. NEVER invent a booking.
- Asking who you are or why you called is identity, not a goodbye. Restate purpose in one sentence and continue. NEVER end_call.

${buildConsultativeSalesProcessPrompt(productName)}

${buildSalesSupportSkillsPrompt(skills, productName, agentName, gender)}

## Lead memory
- Within this agent's memory window: use known name/phone; do not re-collect identity already on file.
- You may briefly reference an **open / upcoming** booking if one is listed in the call notepad.
- **Never volunteer** past, completed, cancelled, or already-used bookings. Only acknowledge that history if the caller clearly recalls prior talk/booking — then one short line and continue helping.

## When to answer vs clarify
- Decide from conversation context whether the caller's meaning is sufficiently clear to answer or act. Do **not** compute or require a numeric confidence score.
- If reasonably clear → answer directly (or use a tool when appropriate). Do not ask a ritual menu.
- If unclear but safely interpretable from this call's history (prior facts, last question, Product Knowledge) → use that interpretation and continue. Do not ask an unnecessary question.
- Ask **one** clarification **only when** remaining ambiguity would materially risk (1) the wrong spoken answer, (2) the wrong action, or (3) calling a tool incorrectly / with the wrong arguments.
- Do not clarify for mild vagueness, mixed language, or messy STT when context already makes the meaning usable.

${buildKnowledgeModePrompt(productName, generalKnowledgeEnabled)}

## Safety
- DNC / do not call: confirm you will not call again (meaning: ${line(core.dnc.confirmLine)}), then end_call. No pitch. Only on **explicit** DNC — never when they asked to call later.
- Not interested **now** but asks to call later / baad mein phone → schedule_callback. Do NOT say you will never call again.
- Not interested with thank-you and **no** callback ask → warm one-sentence close, then end_call. Do not pitch.
- Wrong number: apologize (meaning: ${line(core.wrongNumber.apologizeLine)}), then end_call. No pitch.
- Abusive after a calm boundary fails: end_call. First boundary meaning: ${line(core.abusive.boundaryLine)}.
- Recording concern: disclose briefly (meaning: ${line(compliance.recordingDisclosure)}). If still uncomfortable, offer to end or continue by email.
- Human agent request: acknowledge (meaning: ${line(core.humanHandoff.acknowledge)}) and use schedule_callback with reason human_agent if they want a callback.
- Audio issue: check they can hear you (meaning: ${line(core.audioIssue.checkLine)}); if it persists, offer a callback (meaning: ${line(core.audioIssue.callbackOffer)}).
- Voicemail: one short message (meaning: ${line(core.voicemail.messageScript)}), then end_call.
- Hold: stay silent; the system may send a one-word ack. Soft "are you there?" follow-up only after ~${Math.round((runtime.holdSoftCheckinMs ?? 70_000) / 1000)}s if still on hold.
- Flirty, medical, or deep personal-life digressions: polite boundary; do not engage. Brand complaints, ratings, warranty, and product location questions are product help — answer them.
- After about ${maxRedirects} turns that are clearly not product help, warm goodbye and end_call.

## Tools
- ${PRODUCT_KNOWLEDGE_SEARCH_TOOL} — product detail not visible in Product Knowledge → call silently with a short English query, answer from returned facts only.
- capture_demo_lead — save only when the caller already wants the booking outcome and **Booking policy** gates are done. Never announce booked / noted / confirmed until the tool returns ok:true.
${pack.toolRules ? `${pack.toolRules}\n` : ''}- schedule_callback — only when they want a **later phone call** (busy). Never for product bookings that need capture_demo_lead.
- update_demo_lead_name — after a booking was saved, if they correct the name.
- end_call — after a brief goodbye when they clearly want to stop, DNC, wrong number, or wrap limit. A saved booking is NOT a hangup. After ok:true, restate the saved details and that the payment link will go on WhatsApp, then wait. end_call only if they then say thank you, bye, or bas.

${buildBookingPolicyPrompt(skills.booking)}

## Tool safety
- Never invent or announce an appointment unless capture_demo_lead already returned ok:true.
- **Forbidden spoken claims without ok:true:** "booking confirm ho gayi", "confirm ho gaya", "slot lock", "noted / book ho gaya", "main confirm kar deti/deta hoon" as if saved. Until the tool succeeds, say you will note/check — never that it is already confirmed.
- Never save name or phone on the first hear — read back, get explicit yes/haan, then set the confirm flags.
- When they already want to book, collect only **missing** fields required by Booking policy. This is not a required path for every call.
- ${mergeBookingPolicy(skills.booking).askEmail ? 'Confirm email when required by Booking policy.' : 'Never ask for email on booking. Save with email_skipped=true.'}
- Never invent phone digits. Keep partial digits; ask for the rest. Do not ask for WhatsApp and then skip collecting the number.
- Resolve aaj/kal/parso via **Call time (IST)** to an absolute date; reject past datetimes.
- After ok:true the slot is locked — do not recapture or say it is full unless they ask to change it.

## Same-call memory
- Follow CALL FACTS notes. Never re-ask a fact already answered this call. Next call starts fresh.`;
}

export function getKnownEmailDomains(skills: SkillsConfig): string[] {
  return skills.demo?.knownEmailDomains ?? DEFAULT_SKILLS.demo!.knownEmailDomains ?? [];
}

export function compileSystemPrompt(agent: AgentInput): string {
  const merged = mergeSkillsConfig(agent.skillsConfig);
  const playbook = resolvePlaybook(agent.playbook, merged.booking);
  const skills: SkillsConfig = { ...merged, booking: applyPlaybookToBooking(merged.booking, playbook) };
  const product = agent.productName;
  const languages = parseVoiceLanguages(agent.voiceLanguages);
  const gender: AgentGender = agent.agentGender === 'male' ? 'male' : 'female';
  const contactConfirm = buildContactConfirmPrompt(skills);
  const generalKnowledgeEnabled = agent.generalKnowledgeEnabled !== false;
  const playbookSection = buildPlaybookPrompt(playbook);
  const agentRules = buildAgentRulesPrompt(agent.agentRules);

  return `You are ${agent.name}, a consultative sales and support voice agent for ${product}.
Persona: ${agent.persona}
${agentRules ? `\n${agentRules}\n` : ''}
${buildLanguagePrompt(languages)}
${buildGenderPrompt(gender, languages)}
## Product Knowledge
${productKnowledgeForPrompt(agent)}

${buildPrinciplesPrompt(skills, product, agent.name, gender, generalKnowledgeEnabled)}

${playbookSection}

${contactConfirm}

## Voice rules
- Plain spoken text only. No markdown tables or emojis.
- Default: one to two short sentences per turn. One question at a time is enough; some turns may end with no question.
- Comparison turns: one medium multi-point spoken reply covering Product Knowledge is allowed; do not read raw tables aloud.
- **Price / amount / time / weight / height / age:** spell naturally in the active call language (English → "nine hundred fifty" / "ten lakh" / "forty-five"; Hinglish → "nau sau pachas" / "das lakh" / "paintalis"). Never digit-by-digit for weight/height/age (no "four five" for 45).
- **Times follow language:** English → "two o'clock" / "2 PM" / "one thirty PM" / "ten lakh" (never "das" / "do baje"); Hinglish → "do baje" / "das baje" / "derh baje". Never mix (no "do baja" on an English call). Never write "1:00 PM" or say "colon".
- **Phone, OTP, PIN:** ALWAYS English digit words ("one two three…", "two two"), even on Hinglish calls — never "nau sau", and never "double"/"triple" (forbidden: "double two", "double three"). When a SYSTEM/tool gives a read-back string, speak it verbatim.
- Decimal specs: full words ("one point five" / "derh") — never read "1.0" as "point zero" or "dashamlav".
- ${mergeBookingPolicy(skills.booking).askEmail ? 'Confirm email when Booking policy requires it.' : 'Do not ask for or read back email on booking/demo/visit flows — book with email_skipped=true after phone confirm.'}
- Opener is optional. Do not start every turn with Ji / Hmm / Theek hai / Achha. Ban empty hype ("Arre wah", "Haan haan", "Oh nice").
- Respond only to the main caller. Ignore faint, distant, or side conversations in the background.
- Stay silent when the caller is exploring ("hmm", "aise hai na") — speak only on clear questions. Hold ack: "${skills.runtime?.holdAckLine?.trim() || DEFAULT_RUNTIME.holdAckLine}" only — never narrate waiting.
- Time-of-day greetings follow **Call time (IST)** — Good morning until 12 PM, Good afternoon until 3 PM, Good evening from 3 PM. Never mirror a wrong time-of-day greeting.
- Relative dates (aaj/kal/parso/today/tomorrow/next week/next to next week + weekday): resolve using **Call time (IST)**, confirm the resolved date(s) with explicit calendar dates and month names, and reject past datetimes for scheduling.`;
}

export type CallDirection = 'inbound' | 'outbound';

export interface CallDirectionContext {
  prospectName?: string;
}

export function buildCallDirectionPrompt(
  direction: CallDirection,
  agent: Pick<AgentInput, 'name' | 'productName' | 'greeting'>,
  context?: CallDirectionContext,
): string {
  if (direction === 'outbound') {
    const prospect = context?.prospectName?.trim();
    const prospectLine = prospect
      ? `- You are calling **${prospect}**. Greet them by name: "Hi ${prospect}, ..." — do NOT ask "aapka naam kya hai" or "may I know your name".
- Brief identity check only if needed: "Kya main ${prospect} se baat kar raha/rahi hoon?" (yes/no, not open-ended).`
      : '- No prospect name was provided — introduce yourself and your company without assuming their name.';
    return `## Call direction: OUTBOUND (you called them)
- You placed this sales call to a prospect. You speak first.
- Open with one or two short spoken sentences: greet by name if known, introduce yourself as ${agent.name} from ${agent.productName}, and state WHY you called (follow-up on their enquiry / help them choose the right option). Then ask permission ("Kya main aapse thodi der baat kar sakti/sakta hoon?") OR one discovery question — never a 3-way menu (sedan vs SUV vs budget) on the first turn.
${prospectLine}
- After they say hello / haan / boliye, do NOT re-ask "kya main aapse hi baat kar rahi/raha hoon?". Continue with one useful question.
- After they grant time ("haan" / "yes" / "yes sir" / "boliye" / "bataiye" / "बताइए" / "tell me" / "go ahead"), do NOT re-introduce yourself (no "I'm ${agent.name}" / "main ${agent.name} bol rahi/raha hoon"), do NOT restate the enquiry/opener pitch, and do NOT re-ask "thodi der baat kar sakti/sakta hoon" / "do minute milenge?". Ask ONE discovery question and continue in sticky call language (short English "yes" must not flip a Hinglish call to English).
- If they later ask "call kyon kiya" / "kaun bol rahi/raha": restate the same purpose in one sentence and continue. Never hang up. Never say you are closing the call.
- Use the **Call time (IST)** section for time-of-day greetings — Good morning until 12 PM IST, Good afternoon 12–3 PM, Good evening from 3 PM. Do not say Good morning after noon.
- Do NOT read a fixed script verbatim. Adapt tone from this style reference only: "${agent.greeting}"
- After your opener, listen and follow the principles and tool safety above.`;
  }

  return `## Call direction: INBOUND (they called you)
- The customer called ${agent.productName}. Do NOT speak until they say something first.
- On your **first assistant reply only**: one short inbound greeting — confirm the company/product, introduce yourself as ${agent.name}, and ask how you can help.
- Use the **Call time (IST)** section for time-of-day greetings. If the caller says "Good morning" but it is afternoon/evening IST, reply with the correct greeting (Good afternoon / Good evening / Namaste) — do **not** mirror the wrong time-of-day.
- After that first reply: NEVER re-introduce yourself, NEVER restart with a greeting or "main ${agent.name} bol rahi/raha hoon", and NEVER re-ask the opening menu. Answer from conversation history and the caller's latest ask.
- Match their language with sticky call policy. Explicit "talk in English" locks English until they ask for Hindi/Hinglish. Without lock: Hindi/Hinglish call → stay Roman Hinglish even on mixed English fragments. Then follow the principles and tool safety above.`;
}

export function buildOutboundOpenerInstructions(
  agent: Pick<AgentInput, 'name' | 'productName' | 'greeting'>,
  prospectName?: string,
): string {
  const prospect = prospectName?.trim();
  const ist = getIstNowParts();
  const identity = prospect
    ? `Start your opener with their name: "Hi ${prospect}, ..." You are calling ${prospect} — do NOT ask for their name.`
    : 'Do not assume the prospect name.';
  return (
    'Generate your opening line for this outbound sales call. ' +
    `You are ${agent.name} from ${agent.productName}. ` +
    `${identity} ` +
    `Current IST is ${ist.clockLabel} (${ist.dayPart}) — open with **${ist.greetingEn}** (or Namaste). ` +
    'Never say Good morning after 12 PM IST. Never say Good afternoon after 3 PM IST — use Good evening. ' +
    'State WHY you called in the same breath (follow-up on their enquiry / help them choose). ' +
    'Then one permission question ("Kya main aapse thodi der baat kar sakti/sakta hoon?"). ' +
    'Prefer "thodi der baat" — do NOT say "do minute milenge" or "2 minute". ' +
    'One short turn only, then stop and wait. Do not ask the city, trip, or a second question until the caller answers. ' +
    `Use the greeting style as a tone hint, not a script: "${agent.greeting}"`
  );
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export {
  type KnownContactProfile,
  mergeKnownContact,
  hasKnownContactField,
  buildCallerContextPrompt,
  buildDemoKnownContactRules,
} from './known-contact.js';

export {
  LEAD_MEMORY_RETENTION_PRESETS,
  DEFAULT_LEAD_MEMORY_RETENTION_HOURS,
  normalizeLeadMemoryRetentionHours,
  getLeadMemoryRetentionHours,
  leadMemoryCutoffDate,
  isWithinLeadMemoryWindow,
  isConsumedLead,
  isOpenLead,
  formatOpenBookingSummary,
  buildLeadMemoryRulesPrompt,
  buildOpenBookingPromptLine,
  isCallerPriorRecallCue,
  buildPriorRecallSystemNote,
  type LeadMemoryRetentionHours,
  type LeadMemoryLeadLike,
} from './lead-memory.js';

export {
  PUBLISHED_PRICING_USD,
  USD_TO_INR,
  estimateCallCost,
  estimateS2sCallCost,
  formatAudioDurationMs,
  formatCharacterCount,
  formatInr,
  formatTokenCount,
  formatUsd,
  resolveS2sCostProvider,
  s2sUsageFromMetrics,
  usageDisplayFromMetrics,
  usageFromMetrics,
  type CallUsage,
  type CostBreakdown,
  type S2sCallUsage,
  type S2sCostBreakdown,
  type S2sCostProvider,
  type UsageDisplayBreakdown,
} from './cost-estimate.js';

export {
  type CallerStyle,
  type GlobalLearningCategory,
  type TranscriptLineInput,
  GLOBAL_LEARNING_CATEGORIES,
  MAX_GLOBAL_LEARNING_BULLETS,
  prospectKeyFromName,
  detectCallerStyle,
  parseCallerStyle,
  buildCallerStylePrompt,
  buildLearningsPrompt,
  buildProspectPrompt,
  buildKnowledgeCorpus,
  capMarkdownSection,
  appendUniqueBullet,
  appendGlobalLearning,
  formatGlobalLearningBullet,
  isDuplicateKnowledge,
  isProspectLearningAllowed,
  canAutoApplyGlobalCategory,
  looksLikeAbuseOrInsult,
  normalizeGlobalCategory,
  linesFromTranscriptPayload,
} from './brain-mutation.js';

export {
  parseLearningCategoryFromBullet,
  inferLearningCategoriesFromText,
  inferSituationalSignalsFromText,
  buildGlobalLearningRetrievalQuery,
} from './learning-retrieval.js';

export { buildAgentDeliveryPrompt, buildNaturalReactionsPrompt, buildPatienceTurnTakingPrompt } from './natural-speech.js';

export {
  SIMPLE_EXPLAIN_STICKY_TURNS,
  isSimpleExplainRequest,
  isContinueLastTopicRequest,
  shouldNudgeSimpleExplain,
  buildSimpleExplainSystemNote,
  simpleExplainSkillLine,
} from './simple-explain.js';

export {
  DEFER_BOOKING_STICKY_TURNS,
  isDeferBookingAsk,
  isFrustratedOrAngryTurn,
  isClearBookIntent,
  buildDeferBookingSystemNote,
  buildAngryCallerSystemNote,
  buildSalesSupportSkillsPrompt,
} from './sales-support-skills.js';

export {
  type CallLanguageLock,
  type CallSpeechLanguage,
  type LanguageGuidanceKey,
  isExplicitEnglishRequest,
  isExplicitHinglishOrHindiRequest,
  inferTurnSpeechLanguage,
  speechLanguageFromSttLocale,
  updateCallLanguageLock,
  updateSoftSpeechLanguage,
  effectiveSpeechLanguage,
  ttsLocaleForLock,
  languageGuidanceKey,
  appendLanguageGuidanceIfChanged,
  buildLanguageLockSystemNote,
  buildSpeechLanguageSystemNote,
} from './call-language.js';

export {
  isBareDurationTurn,
  isClearBusyOrCallbackTurn,
  shouldMuteBareDurationTurn,
  buildBareDurationBusySafetyNote,
  buildCallbackSystemNote,
  looksLikeGarbageTranscript,
  buildUnclearSpeechClarifySystemNote,
} from './call-busy.js';

export {
  type DayPart,
  type IstNowParts,
  dayPartFromHour,
  greetingForDayPart,
  getIstNowParts,
  getIstCalendarParts,
  addIstCalendarDays,
  daysFromMonday,
  resolveIstWeekdayInWeek,
  istWeekBounds,
  isTimeOfDayGreeting,
  buildRelativeDateRulesPrompt,
  buildCallTimeContextPrompt,
  buildTimeGreetingSystemNote,
} from './call-time.js';

export {
  type SpokenTimeLang,
  spokenClockTime,
  rewriteClockTimesForSpeech,
  rewriteHindiQuantityWordsForEnglishSpeech,
  rewriteRahiForSpeech,
  prepareEnglishLockSpeech,
  formatSpokenSlotAlternative,
  formatSpokenSlotAlternatives,
} from './spoken-time.js';

export {
  type BookingType,
  type ParsedSchedule,
  DEFAULT_BOOKING_DURATIONS_MIN,
  parsePreferredTime,
  durationMinutesForBookingType,
  intervalsOverlap,
  istWallToUtcDate,
  toIstIsoDate,
  formatSlotKey,
} from './schedule-parse.js';

export {
  type AvailabilityConfig,
  type ExistingBooking,
  type CalendarSlot,
  type MonthDaySummary,
  DEFAULT_AVAILABILITY,
  DISABLED_AVAILABILITY,
  normalizeAvailabilityConfig,
  generateDaySlots,
  paintDaySlots,
  isSlotAvailable,
  buildMonthSummary,
  isDateOpen,
  isWithinOpenHours,
  findNextFreeSlots,
  istMinutesOfDay,
  slotDurationFor,
  formatOpenHoursLabel,
  formatOpenDaysLabel,
  formatBookingWindowLabel,
} from './availability.js';

export {
  isExploringOrThinkingTurn,
  isStatingConsiderationTurn,
  isDirectQuestionToAgent,
  isTellMeMoreTurn,
  shouldSuppressAgentReply,
  shouldBargeInOnSpeech,
  isUrgentBargeInCue,
  isGoAheadCue,
  isPermissionGrantCue,
  isPermissionGrantedTurn,
  isPoliteEndCue,
  looksLikePermissionAsk,
  looksTruncatedAssistantTurn,
  looksIncompleteUserTurn,
  userTurnCommitDelayMs,
  shouldCommitUserTurn,
  USER_TURN_INCOMPLETE_DELAY_MS,
  USER_TURN_COMPLETE_DELAY_MS,
  USER_TURN_DEFAULT_DELAY_MS,
  USER_TURN_COMMIT_CAP_MS,
  USER_TURN_SAME_BREATH_MS,
  isClearRefusalTurn,
  isAvailabilityTimelineTurn,
  buildContinueInterruptedSystemNote,
  buildGoAheadDiscoverySystemNote,
  buildInterruptedNewQuestionNote,
  buildPoliteEndSystemNote,
  buildRefusalCloseSystemNote,
  buildAvailabilityTimelineSystemNote,
  buildTellMeMoreSystemNote,
} from './call-patience.js';

export {
  SPECULATIVE_STABLE_MS,
  HOLD_ACK_AFTER_MS,
  FIRST_CHUNK_MIN_WORDS,
  normalizeHeard,
  shouldSpeculateOnInterim,
  speculativeHeardMatch,
  extractNewSpokenChunks,
} from './spoken-latency.js';

export { mergeUserUtterance, isSameUtteranceContinuation, isNearDuplicateUtterance } from './user-turn-endpoint.js';

export {
  LLM_SPOKEN_HISTORY_KEEP,
  trimSpokenHistoryForLlm,
  type SpokenHistoryMessage,
} from './spoken-history.js';

export {
  HOLD_ACK_LINE,
  HOLD_SOFT_CHECKIN_LINE,
  HOLD_SOFT_CHECKIN_MS,
  HOLD_RESUME_SYSTEM_NOTE,
  isHoldRequest,
  isHoldResumeCue,
  shouldExitHold,
} from './call-hold.js';

export {
  buildContactConfirmPrompt,
  expandDigitsToEnglishWords,
  spokenPhoneForReadBack,
} from './contact-confirm.js';

export {
  validateLeadEmail,
  emailRequiresCallerConfirm,
  RFC_EMAIL_REGEX,
  type LeadEmailValidation,
} from './email-utils.js';

export {
  agentTurnRequestedPhoneCapture,
  isPhoneCaptureActive,
  shouldRunPhoneProtocol,
  looksLikePhoneDigitUtterance,
} from './phone-protocol.js';

export {
  emptyPhoneBuffer,
  ingestPhoneUtterance,
  mergePhoneDigits,
  detectLeadingDigitPatch,
  buildPhoneProtocolSystemNote,
  looksLikeNameMissComplaint,
  buildNameRecoverySystemNote,
  isPhoneConfirmCue,
  isPhoneRejectCue,
  type PhoneBufferState,
  type PhoneIngestKind,
  type PhoneIngestResult,
} from './phone-buffer.js';

export {
  emptyCallFacts,
  updateCallFactsFromTurn,
  buildCallFactsSystemNote,
  detectAskedTopics,
  extractFactsFromUserTurn,
  extractCatalogModelNames,
  mergeCallFacts,
  callFactsSnapshot,
  isProductChoiceInterestTurn,
  isNextStepAskTurn,
  callFactsGainedProductChoice,
  buildBuyingInterestSystemNote,
  buildNextStepAskSystemNote,
  type CallFactsState,
  type CallFactKey,
} from './call-facts.js';

export {
  normalizeSpokenPhone,
  formatPhoneForSpeech,
  digitsToEnglishWords,
  digitsToWords,
  phoneRawContainsLetters,
  validateLeadPhone,
  type LeadPhoneValidation,
  type PhoneSpeechLocale,
} from './phone-utils.js';

export {
  SILENCE_CHECK_COUNT,
  SILENCE_CHECK_MS,
  looksLikeHumanReply,
  looksLikeVoicemailPrompt,
  silenceStep,
} from './phone-silence.js';
export { callerAskedToEndCall } from './hangup-phrase.js';

export {
  correctTranscriptForLlm,
  applyProductNameAliases,
  applySuvSttAliases,
  stripSttEchoFillers,
  shouldConfirmUnclearStt,
  sttClarifyLine,
  buildSttConfidenceNote,
  LOW_CONFIDENCE_REPEAT_PROMPT,
  type TranscriptCorrectionInput,
  type TranscriptCorrectionResult,
} from './transcript-correction.js';

export { assembleSttPhraseList, isAutomotiveProduct, isVolkswagenProduct };

/** Azure phrase boost for simulator + telephony. Product name first; VW names only for VW agents. */
export function buildSttPhraseList(
  productName: string,
  skillsConfig?: Partial<SkillsConfig> | null,
): string[] {
  const skills = mergeSkillsConfig(skillsConfig);
  const extra: string[] = [];
  for (const domain of getKnownEmailDomains(skills)) {
    extra.push(domain);
    const label = domain.split('.')[0];
    if (label) extra.push(label);
  }
  return assembleSttPhraseList(productName, extra);
}

export {
  isLikelyOffTopicOrPersonalTurn,
  isLikelyProductOrSalesTurn,
  isCallPurposeOrIdentityTurn,
  withProductPlaceholder,
  buildOffTopicRedirectSystemNote,
  buildCallPurposeSystemNote,
  buildWrapLimitSystemNote,
} from './off-topic-wrap.js';

export {
  stripSystemNotesForDisplay,
  stripAgentToolNoiseForDisplay,
  sanitizeSpokenHistoryForLlm,
} from './strip-system-notes.js';

export {
  BRAIN_MAP,
  RUNTIME_CODE_ITEMS,
  SKILL_FIELD_DEFS,
  brainItemsByHemisphere,
  getSkillFieldValue,
  groupedSkillFields,
  setSkillFieldValue,
  skillFieldsByCategory,
  type BrainHemisphere,
  type BrainMapItem,
  type SkillFieldDef,
  type SkillUiCategory,
} from './skill-catalog.js';

export {
  compactSystemPrompt,
  rewriteVoiceRulesForSimulator2,
  SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS,
} from './simulator2-compact-prompt.js';

export { buildSimulator2NaturalVoicePrompt } from './simulator2-natural-voice.js';

export {
  ACKS,
  SOFT_OPENERS,
  assistantEndedWithQuestion,
  buildFeelSystemNote,
  emptyConversationFeel,
  extractLeadingOpener,
  extractSalesBridge,
  openerFamily,
  rememberAgentOpener,
  type ConversationFeelState,
} from './simulator2-conversation-feel.js';

export {
  SIMULATOR2_DEFAULT_LLM_MODEL,
  SIMULATOR2_DEFAULT_TTS_EMOTION,
  assembleAgentInstructions,
  assembleSimulator2InstructionBlocks,
  resolveCallLlm,
  resolveSimulator2LlmModel,
  resolveSimulator2TtsEmotion,
  type CallLlmProvider,
  type Simulator2InstructionAgent,
  type Simulator2Instructions,
  type Simulator2ProspectMemory,
} from './simulator2-instructions.js';

export {
  inrToEnglishWords,
  latestSpokenName,
  latestSpokenPhone,
  spokenIntakeCorrection,
  spokenToolLeakLine,
} from './spoken-intake-guard.js';

export {
  emptySimulator2TurnState,
  FAKE_BOOKING_CORRECTION_LINE,
  FAKE_BOOKING_CORRECTION_LINE_EN,
  fakeBookingCorrectionLine,
  looksLikeBookingConfirmedClaim,
  markBookingSaved,
  prepareSimulator2UserTurn,
  prepareUserTurn,
  rememberSimulator2Assistant,
  type Simulator2TurnResult,
  type Simulator2TurnState,
} from './simulator2-turn.js';

export {
  applyOutboundConversationTurn,
  emptyOutboundFocus,
  extractOutboundModel,
  extractOutboundVariant,
  isOutboundAttentionUtterance,
  isOutboundAudioIssueUtterance,
  isOutboundConfusionUtterance,
  isOutboundStayOnLineUtterance,
  isOutboundThankYouUtterance,
  isOutboundVariantListAsk,
  isOutboundWaitUtterance,
  productKnowledgeFromSources,
  rememberOutboundAssistant,
  retrieveOutboundCatalog,
  shouldOutboundCutSpeech,
  type OutboundFocusState,
  type OutboundIntent,
  type OutboundTurnAction,
} from './outbound-conversation.js';

import {
  assembleAgentInstructions,
  type Simulator2InstructionAgent,
  type Simulator2Instructions,
} from './simulator2-instructions.js';

export function buildSimulator2Instructions(opts: {
  agent: Simulator2InstructionAgent;
  direction: CallDirection;
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
  skills: SkillsConfig;
}): Simulator2Instructions {
  return assembleAgentInstructions({
    ...opts,
    refreshLanguagePrompt,
    ensureGenderPrompt,
    buildCallDirectionPrompt,
  });
}

export {
  NEXORA_HOTEL_SELECT_FIELDS,
  isNexoraHotelFactsConfigured,
  cityQueryCandidates,
  canonicalizeHotelCityForApi,
  canonicalizeHotelStateForApi,
  resolveHotelMatchForApi,
  toNexoraMatchArray,
  buildNexoraHotelMatch,
  buildNexoraHotelKnown,
  parseStayRoomTypeList,
  textMentionsKnownHotelCity,
  extractKnownHotelCityFromText,
  extractKnownHotelCitiesFromText,
  stayInventoryCities,
  hotelNameQueryCandidates,
  summarizeNexoraHotelFactsPayload,
  compactHotelFactsForLlm,
  roomHasLiveRate,
  queryNexoraHotelFacts,
  resolveStayInventoryQuery,
  evaluateStayInventoryForBooking,
  assertLiveStayInventoryForBooking,
  matchStayRoom,
  stayInventoryDateFromPreferredTime,
  type NexoraHotelKnown,
  type NexoraHotelKnownPayload,
  type NexoraHotelRoomSummary,
  type NexoraPropertyPolicies,
  type NexoraHotelFactsSummary,
  type NexoraHotelFactsError,
  type NexoraMatchPrefer,
  type StayInventoryGateResult,
} from './nexora-hotel-facts.js';
