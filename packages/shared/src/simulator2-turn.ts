import {
  buildCallerGenderSystemNote,
  inferCallerGender,
  type CallerGender,
} from './caller-gender.js';
import {
  buildCallbackSystemNote,
  isClearBusyOrCallbackTurn,
  shouldMuteBareDurationTurn,
} from './call-busy.js';
import {
  buildHinglishGenderCorrectionNote,
  spokenUsesWrongHinglishGender,
} from './hinglish-gender.js';
import { resolvePackForBooking } from './packs/index.js';
import {
  emptyCallFacts,
  mergeCallFacts,
  updateCallFactsFromTurn,
  buildCallFactsSystemNote,
  type CallFactsState,
} from './call-facts.js';
import {
  HOLD_ACK_LINE,
  HOLD_RESUME_SYSTEM_NOTE,
  HOLD_SOFT_CHECKIN_LINE,
  isHoldRequest,
  shouldExitHold,
} from './call-hold.js';
import {
  appendLanguageGuidanceIfChanged,
  effectiveSpeechLanguage,
  ttsLocaleForLock,
  updateCallLanguageLock,
  updateSoftSpeechLanguage,
  type CallLanguageLock,
  type CallSpeechLanguage,
  type LanguageGuidanceKey,
} from './call-language.js';
import {
  buildContinueInterruptedSystemNote,
  buildGoAheadDiscoverySystemNote,
  buildInterruptedNewQuestionNote,
  buildPoliteEndSystemNote,
  isClearRefusalTurn,
  isDirectQuestionToAgent,
  isGoAheadCue,
  isPermissionGrantCue,
  isPermissionGrantedTurn,
  isPoliteEndCue,
  looksLikePermissionAsk,
  looksTruncatedAssistantTurn,
  shouldSuppressAgentReply,
} from './call-patience.js';
import {
  DEFER_BOOKING_STICKY_TURNS,
  isDeferBookingAsk,
  isFrustratedOrAngryTurn,
  isClearBookIntent,
  buildDeferBookingSystemNote,
  buildAngryCallerSystemNote,
} from './sales-support-skills.js';
import { isTimeOfDayGreeting, buildTimeGreetingSystemNote } from './call-time.js';
import {
  buildCallPurposeSystemNote,
  buildOffTopicRedirectSystemNote,
  buildWrapLimitSystemNote,
  isCallPurposeOrIdentityTurn,
  isLikelyOffTopicOrPersonalTurn,
  isLikelyProductOrSalesTurn,
} from './off-topic-wrap.js';
import {
  emptyPhoneBuffer,
  ingestPhoneUtterance,
  looksLikeNameMissComplaint,
  buildNameRecoverySystemNote,
  type PhoneBufferState,
} from './phone-buffer.js';
import { looksLikePhoneDigitUtterance, shouldRunPhoneProtocol } from './phone-protocol.js';
import type { SkillsConfig } from './skills-types.js';
import { correctTranscriptForLlm, shouldConfirmUnclearStt, sttClarifyLine } from './transcript-correction.js';
import type { CallDirection } from './known-contact.js';
import {
  buildPriorRecallSystemNote,
  isCallerPriorRecallCue,
} from './lead-memory.js';
import {
  applyOutboundConversationTurn,
  emptyOutboundFocus,
  isOutboundAudioIssueUtterance,
  rememberOutboundAssistant,
  type OutboundFocusState,
} from './outbound-conversation.js';
import {
  emptyConversationFeel,
  rememberAgentOpener,
  type ConversationFeelState,
} from './simulator2-conversation-feel.js';

/**
 * Claims the booking/slot is *already* done. Deliberately excludes bare "confirm" /
 * "please confirm" / "confirm karna" — those are intake questions, not false saves.
 */
const BOOKING_ALREADY_CONFIRMED_RE =
  /\b(?:confirm\s+ho\s+gay(?:a|i)|(?:aapki\s+)?booking\s+(?:is\s+)?confirm(?:ed)?(?:\s+ho(?:\s+gay(?:a|i))?)?|slot\s+(?:is\s+)?confirm(?:ed)?(?:\s+ho(?:\s+gay(?:a|i))?)?|visit\s+(?:is\s+)?confirm(?:ed)?(?:\s+ho(?:\s+gay(?:a|i))?)?|book\s+ho\s+gay(?:a|i)|lock\s+kar\s+diya|already\s+booked|slot\s+(?:is\s+)?lock(?:ed)?)\b/i;

/** Asking the caller to verify a detail — must never trigger the fake-booking guard. */
const ASK_CALLER_TO_CONFIRM_RE =
  /\bplease\s+confirm\b|\bconfirm\s+(?:kar(?:na|o|e|iye|ungi|unga)?|so\s+i|ki?\s*jiye)\b|\bis\s+it\b[\s\S]{0,60}\bconfirm\b/i;

/** Our own correction / "not saved yet" speech — must never re-trigger. */
const BOOKING_PENDING_SELF_RE =
  /save pending|save nahi hui|abhi tak save|not\s+(?:yet\s+)?saved|pending hai/i;

/** True when spoken text claims a booking/slot is already confirmed. */
export function looksLikeBookingConfirmedClaim(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ASK_CALLER_TO_CONFIRM_RE.test(t)) return false;
  if (BOOKING_PENDING_SELF_RE.test(t)) return false;
  return BOOKING_ALREADY_CONFIRMED_RE.test(t);
}

function looksLikeBookingConfirmed(text: string): boolean {
  return looksLikeBookingConfirmedClaim(text);
}

/** Spoken correction — no "confirm" word so the session guard cannot loop on itself. */
export const FAKE_BOOKING_CORRECTION_LINE =
  'Abhi booking save pending hai — abhi tak save nahi hui. Jo detail missing hai wo bataiye.';

/** Same correction in English so an English-locked call does not flip accent mid-sentence. */
export const FAKE_BOOKING_CORRECTION_LINE_EN =
  'The booking is not saved yet. Tell me the one detail that is still missing.';

export function fakeBookingCorrectionLine(language: 'en' | 'hinglish' | null | undefined): string {
  return language === 'en' ? FAKE_BOOKING_CORRECTION_LINE_EN : FAKE_BOOKING_CORRECTION_LINE;
}

function buildFakeBookingConfirmSystemNote(): string {
  return (
    '[SYSTEM: You just claimed a booking/slot was confirmed, but capture_demo_lead has NOT returned ok:true this call. ' +
    'Do NOT repeat that the booking is confirmed. Briefly correct if needed ("abhi save pending hai"), ' +
    'collect only missing required fields, then call capture_demo_lead. Never invent a confirmation.]'
  );
}

/** Product-agnostic "what / which / where / available" ask — pack hooks may handle it first. */
function isProductCatalogHelpAsk(text: string): boolean {
  return /\b(options?|offerings?|variants?|models?|plans?|packages?|types?|location|located|kahan|kahaan|kaunsa|kaunse|kaun\s*sa|which|nearby|paas|availability|available|details?|facilit(?:y|ies)|amenit(?:y|ies))\b|लोकेशन|कौन\s*स[ेा]|कहाँ|उपलब्ध|सुविधा/i.test(
    text,
  );
}

function buildProductCatalogHelpFirstNote(productName: string): string {
  return (
    `[SYSTEM: Caller asked a product / catalog question about ${productName}. ` +
    `Answer from Product Knowledge now — if the detail is not visible there, call search_product_knowledge silently first. ` +
    `Do NOT ask for name, phone, WhatsApp, or payment acknowledgment before answering. ` +
    `Do NOT deflect with "pehle details chahiye". Do NOT pitch booking / "details collect" this turn. ` +
    `One short useful answer; intake only after they clearly want to book.]`
  );
}

function isAnswerFirstComplaint(text: string): boolean {
  return (
    isDeferBookingAsk(text) ||
    /\b(pehle\s+jawab|meri\s+baat\s+suno|ek\s+chee[z]\s+mein|baar[\s-]*baar\s+detail|atak\s+gay|jawab\s+to\s+de|answer\s+(?:first|my\s+question)|pehle\s+(?:mera\s+)?(?:sawal|question))\b|पहले\s*जवाब|मेरी\s*बात\s*सुन|अटक/i.test(
      text,
    )
  );
}

function buildAnswerFirstComplaintNote(): string {
  return buildDeferBookingSystemNote();
}

function isPostBookingClose(text: string): boolean {
  if (isPoliteEndCue(text)) return true;
  if (!/\b(thank\s*you|thanks|thx|dhanyavaad|shukriya|bye+|goodbye|alvida)\b/i.test(text)) {
    return false;
  }
  if (/\b(change|reschedule|doosra|another\s+(?:slot|time)|available\s+timing)\b/i.test(text)) {
    return false;
  }
  return true;
}

function bookingLockedCloseLine(
  locale: 'en' | 'hi' | null,
  preferredTime?: string,
): string {
  const time = preferredTime?.trim();
  if (locale === 'en') {
    return time
      ? `Your slot is confirmed for ${time}. Thank you, goodbye.`
      : 'Your booking is confirmed. Thank you, goodbye.';
  }
  return time
    ? `Bilkul — aapka slot ${time} par confirm hai. Dhanyavaad, bye!`
    : 'Bilkul — aapka slot confirm hai. Dhanyavaad, bye!';
}

export type Simulator2TurnState = {
  offTopicStrikes: number;
  wrapForced: boolean;
  bookingSaved: boolean;
  onHold: boolean;
  holdStartedAt: number;
  holdSoftCheckinDone: boolean;
  exploringUntil: number;
  languageLock: CallLanguageLock | null;
  softSpeechLanguage: CallSpeechLanguage | null;
  lastInjectedLanguageKey: LanguageGuidanceKey | null;
  lastTtsLocale: 'en' | 'hi' | null;
  phoneBuffer: PhoneBufferState;
  callFacts: CallFactsState;
  conversationFeel: ConversationFeelState;
  lastRememberedAssistant: string;
  recentUserTurns: string[];
  simpleExplainTurnsLeft: number;
  /** Keep answering from Brain — no booking pitch for N turns. */
  deferBookingTurnsLeft: number;
  callerInterrupted: boolean;
  outboundFocus: OutboundFocusState;
  /** Prospect gender this call — unknown until verbs or a clearly gendered name. */
  callerGender: CallerGender;
};

export function emptySimulator2TurnState(): Simulator2TurnState {
  return {
    offTopicStrikes: 0,
    wrapForced: false,
    bookingSaved: false,
    onHold: false,
    holdStartedAt: 0,
    holdSoftCheckinDone: false,
    exploringUntil: 0,
    languageLock: null,
    softSpeechLanguage: null,
    lastInjectedLanguageKey: null,
    lastTtsLocale: null,
    phoneBuffer: emptyPhoneBuffer(),
    callFacts: emptyCallFacts(),
    conversationFeel: emptyConversationFeel(),
    lastRememberedAssistant: '',
    recentUserTurns: [],
    simpleExplainTurnsLeft: 0,
    deferBookingTurnsLeft: 0,
    callerInterrupted: false,
    outboundFocus: emptyOutboundFocus(),
    callerGender: 'unknown',
  };
}

export type Simulator2TurnResult = {
  state: Simulator2TurnState;
  ttsLocale: 'en' | 'hi' | null;
} & (
  | { kind: 'mute'; reason: string }
  | { kind: 'say'; text: string; then: 'listen' | 'hangup'; hangupReason?: string }
  | { kind: 'reply'; userContent: string }
);

export function rememberSimulator2Assistant(
  state: Simulator2TurnState,
  assistantText: string,
): Simulator2TurnState {
  const text = assistantText.trim();
  if (!text || text === state.lastRememberedAssistant) return state;
  return {
    ...state,
    conversationFeel: rememberAgentOpener(state.conversationFeel, text),
    lastRememberedAssistant: text,
    outboundFocus: rememberOutboundAssistant(state.outboundFocus ?? emptyOutboundFocus(), text),
  };
}

export function markBookingSaved(
  state: Simulator2TurnState,
  preferredTime?: string,
): Simulator2TurnState {
  const facts: Record<string, string> = { booking: 'saved' };
  if (preferredTime?.trim()) facts.preferred_time = preferredTime.trim();
  return {
    ...state,
    bookingSaved: true,
    callFacts: mergeCallFacts(state.callFacts, { facts }),
  };
}

function buildFeaturesPricingDirectAnswerNote(productName: string): string {
  return (
    `[SYSTEM: Caller asked about ${productName} features or pricing. Answer directly from Product Knowledge — ` +
    `list specific features or pricing tiers when available. Do not deflect with generic "use case" or ` +
    `"team size" questions unless pricing is truly missing from Product Knowledge. Keep it concise.]`
  );
}

export async function prepareSimulator2UserTurn(input: {
  heard: string;
  confidence?: number;
  sttLocale?: string | null;
  lastAssistantText: string;
  recentAssistantTexts: string[];
  productName: string;
  skills: SkillsConfig;
  knownEmailDomains: string[];
  state: Simulator2TurnState;
  /** When omitted, treated as inbound (existing behavior). */
  direction?: CallDirection;
  /** Admin Brain / compiled product section — used for catalog facts and outbound grounding. */
  productKnowledge?: string;
  /** Set by capture_demo_lead ok:true in the worker. */
  bookingLock?: { saved: boolean; preferredTime?: string };
  /** Female/male first-person Hinglish grammar for the agent. */
  agentGender?: string;
  /** Known prospect / lead name (outbound or CRM). */
  contactName?: string;
  /** Outbound only — agent has already spoken the opening line. */
  openerDelivered?: boolean;
  /**
   * When true, consumed/past bookings exist in the retention window.
   * Enables a short SYSTEM note if the caller recalls prior talk/booking.
   */
  hasConsumedLeadHistory?: boolean;
}): Promise<Simulator2TurnResult> {
  const heard = input.heard.trim();
  if (!heard) {
    return { kind: 'mute', reason: 'empty', state: input.state, ttsLocale: input.state.lastTtsLocale };
  }

  let state = {
    ...input.state,
    simpleExplainTurnsLeft: input.state.simpleExplainTurnsLeft ?? 0,
    deferBookingTurnsLeft: input.state.deferBookingTurnsLeft ?? 0,
    callerInterrupted: input.state.callerInterrupted ?? false,
    outboundFocus: input.state.outboundFocus ?? emptyOutboundFocus(),
  };
  if (input.bookingLock?.saved) {
    state = markBookingSaved(state, input.bookingLock.preferredTime);
  }
  const runtime = input.skills.runtime;
  const holdAckLine = runtime?.holdAckLine?.trim() || HOLD_ACK_LINE;
  const audioCheckLine = input.skills.core?.audioIssue?.checkLine?.trim() ?? '';
  const holdSoftCheckinMs = Math.max(5_000, runtime?.holdSoftCheckinMs ?? 70_000);
  const exploringSilenceMs = Math.max(1_000, runtime?.exploringSilenceMs ?? 5_000);
  const maxRedirects = Math.max(1, input.skills.offTopic.maxRedirects);
  const forceAtStrike = maxRedirects + 1;

  const syncTts = (effective: CallSpeechLanguage | null): 'en' | 'hi' | null => {
    const locale = ttsLocaleForLock(effective);
    state.lastTtsLocale = locale;
    return locale;
  };

  if (shouldMuteBareDurationTurn(heard)) {
    return { kind: 'mute', reason: 'bare-duration', state, ttsLocale: state.lastTtsLocale };
  }

  const recentAssistantTexts = input.recentAssistantTexts.filter(Boolean);
  const lastAssistantTurn = input.lastAssistantText.trim() || recentAssistantTexts.at(-1) || '';
  if (lastAssistantTurn && lastAssistantTurn !== state.lastRememberedAssistant) {
    state = rememberSimulator2Assistant(state, lastAssistantTurn);
  }

  const contextTurns = [...recentAssistantTexts.slice(-2), ...state.recentUserTurns.slice(-4)];
  const phoneCaptureActive = shouldRunPhoneProtocol(lastAssistantTurn, recentAssistantTexts.slice(-4));

  const correction = await correctTranscriptForLlm({
    heard,
    confidence: input.confidence,
    productName: input.productName,
    knownEmailDomains: input.knownEmailDomains,
    recentTurns: contextTurns,
  });

  const textForLlm =
    correction.wasCorrected && correction.corrected !== heard ? correction.corrected : heard;

  state.recentUserTurns = [...state.recentUserTurns, heard].slice(-6);

  const contactName = input.contactName?.trim() || state.callFacts.facts.name;
  const callerGender = inferCallerGender({
    spokenText: textForLlm,
    name: contactName,
    previous: state.callerGender,
  });
  state = {
    ...state,
    callerGender,
    callFacts:
      callerGender === 'male' || callerGender === 'female'
        ? mergeCallFacts(state.callFacts, { facts: { caller_gender: callerGender } })
        : state.callFacts,
  };

  if (shouldMuteBareDurationTurn(textForLlm)) {
    return { kind: 'mute', reason: 'bare-duration', state, ttsLocale: state.lastTtsLocale };
  }

  const directQuestion = isDirectQuestionToAgent(textForLlm);
  const continueInterrupted =
    looksTruncatedAssistantTurn(lastAssistantTurn) && isGoAheadCue(textForLlm);
  const permissionGranted =
    isPermissionGrantedTurn(textForLlm, lastAssistantTurn) ||
    (isPermissionGrantCue(textForLlm) && looksLikePermissionAsk(lastAssistantTurn));
  const identityTurn = isCallPurposeOrIdentityTurn(textForLlm);
  const politeEnd = isPoliteEndCue(textForLlm);
  const callbackTurn = isClearBusyOrCallbackTurn(textForLlm);
  if (
    !phoneCaptureActive &&
    !permissionGranted &&
    !politeEnd &&
    !callbackTurn &&
    !continueInterrupted &&
    !directQuestion &&
    shouldConfirmUnclearStt(textForLlm)
  ) {
    return {
      kind: 'say',
      text: sttClarifyLine(lastAssistantTurn),
      then: 'listen',
      state,
      ttsLocale: state.lastTtsLocale,
    };
  }
  if (state.bookingSaved) {
    state.callFacts = mergeCallFacts(state.callFacts, { facts: { booking: 'saved' } });
  }
  if (state.bookingSaved && isPostBookingClose(textForLlm) && !isClearRefusalTurn(textForLlm)) {
    const locale = ttsLocaleForLock(
      effectiveSpeechLanguage(state.languageLock, state.softSpeechLanguage),
    ) ?? state.lastTtsLocale;
    state.lastTtsLocale = locale;
    return {
      kind: 'say',
      text: bookingLockedCloseLine(locale, state.callFacts.facts.preferred_time),
      then: 'hangup',
      hangupReason: 'caller_goodbye',
      state,
      ttsLocale: locale,
    };
  }
  let holdResumePending = false;

  if (state.onHold) {
    if (shouldExitHold(textForLlm)) {
      state.onHold = false;
      state.holdSoftCheckinDone = false;
      state.exploringUntil = 0;
      holdResumePending = true;
    } else {
      if (
        !state.holdSoftCheckinDone &&
        state.holdStartedAt > 0 &&
        Date.now() - state.holdStartedAt >= holdSoftCheckinMs
      ) {
        state.holdSoftCheckinDone = true;
        return {
          kind: 'say',
          text: HOLD_SOFT_CHECKIN_LINE,
          then: 'listen',
          state,
          ttsLocale: state.lastTtsLocale,
        };
      }
      return { kind: 'mute', reason: 'hold', state, ttsLocale: state.lastTtsLocale };
    }
  } else if (isHoldRequest(textForLlm)) {
    state.onHold = true;
    state.holdStartedAt = Date.now();
    state.holdSoftCheckinDone = false;
    state.exploringUntil = 0;
    return { kind: 'say', text: holdAckLine, then: 'listen', state, ttsLocale: state.lastTtsLocale };
  }

  const skipExploringForAudio =
    input.direction === 'outbound' &&
    (state.outboundFocus.audioRepair || isOutboundAudioIssueUtterance(textForLlm));

  if (
    !skipExploringForAudio &&
    Date.now() < state.exploringUntil &&
    !directQuestion &&
    !politeEnd &&
    !callbackTurn &&
    !permissionGranted
  ) {
    if (shouldSuppressAgentReply(textForLlm)) {
      state.exploringUntil = Date.now() + exploringSilenceMs;
      return { kind: 'mute', reason: 'exploring', state, ttsLocale: state.lastTtsLocale };
    }
    state.exploringUntil = 0;
  }

  if (!skipExploringForAudio && !permissionGranted && shouldSuppressAgentReply(textForLlm)) {
    state.exploringUntil = Date.now() + exploringSilenceMs;
    return { kind: 'mute', reason: 'exploring', state, ttsLocale: state.lastTtsLocale };
  }

  if (directQuestion || politeEnd || callbackTurn || permissionGranted) {
    state.exploringUntil = 0;
  }

  let outboundNote: string | null = null;
  if (input.direction === 'outbound' && !holdResumePending) {
    const outbound = applyOutboundConversationTurn({
      text: textForLlm,
      productName: input.productName,
      productKnowledge: input.productKnowledge ?? '',
      focus: state.outboundFocus,
      phoneCaptureActive,
      openerDelivered: input.openerDelivered,
    });
    state.outboundFocus = outbound.focus;
    if (outbound.focus.model) {
      state.callFacts = mergeCallFacts(state.callFacts, { facts: { model: outbound.focus.model } });
    }
    if (outbound.focus.variant) {
      state.callFacts = mergeCallFacts(state.callFacts, {
        facts: { variant: outbound.focus.variant },
      });
    }
    if (outbound.kind === 'mute') {
      return { kind: 'mute', reason: outbound.reason, state, ttsLocale: state.lastTtsLocale };
    }
    if (outbound.kind === 'hold') {
      state.onHold = true;
      state.holdStartedAt = Date.now();
      state.holdSoftCheckinDone = false;
      state.exploringUntil = 0;
      return { kind: 'say', text: holdAckLine, then: 'listen', state, ttsLocale: state.lastTtsLocale };
    }
    if (outbound.kind === 'audio-check') {
      state.exploringUntil = 0;
      if (!audioCheckLine) {
        return { kind: 'mute', reason: 'outbound-audio', state, ttsLocale: state.lastTtsLocale };
      }
      return { kind: 'say', text: audioCheckLine, then: 'listen', state, ttsLocale: state.lastTtsLocale };
    }
    outboundNote = outbound.systemNote;
  }

  const phoneDigitTurn = phoneCaptureActive && looksLikePhoneDigitUtterance(textForLlm);

  const offTopic =
    !phoneDigitTurn &&
    !phoneCaptureActive &&
    !isCallPurposeOrIdentityTurn(textForLlm) &&
    isLikelyOffTopicOrPersonalTurn(textForLlm);
  const onProduct = isLikelyProductOrSalesTurn(textForLlm);

  if (offTopic) {
    state.offTopicStrikes += 1;
  } else if (onProduct) {
    state.offTopicStrikes = 0;
  }

  if (offTopic && state.offTopicStrikes >= forceAtStrike) {
    state.wrapForced = true;
  }

  state.languageLock = updateCallLanguageLock(textForLlm, state.languageLock);
  state.softSpeechLanguage = updateSoftSpeechLanguage(
    textForLlm,
    state.softSpeechLanguage,
    input.sttLocale,
  );
  const effective = effectiveSpeechLanguage(state.languageLock, state.softSpeechLanguage);
  const locale = syncTts(effective);

  let baseForLock = textForLlm;
  if (holdResumePending) {
    baseForLock = `${textForLlm}\n\n${HOLD_RESUME_SYSTEM_NOTE}`;
  }
  if (continueInterrupted) {
    baseForLock = `${baseForLock}\n\n${buildContinueInterruptedSystemNote(lastAssistantTurn)}`;
    state.callerInterrupted = false;
  } else if (permissionGranted) {
    baseForLock = `${baseForLock}\n\n${buildGoAheadDiscoverySystemNote()}`;
    state.callerInterrupted = false;
  } else if (callbackTurn) {
    baseForLock = `${baseForLock}\n\n${buildCallbackSystemNote()}`;
    state.callerInterrupted = false;
  } else if (politeEnd) {
    baseForLock = `${baseForLock}\n\n${buildPoliteEndSystemNote(state.bookingSaved)}`;
    state.callerInterrupted = false;
  } else if (state.callerInterrupted) {
    baseForLock = `${baseForLock}\n\n${buildInterruptedNewQuestionNote()}`;
    state.callerInterrupted = false;
  }
  if (isTimeOfDayGreeting(textForLlm)) {
    baseForLock = `${baseForLock}\n\n${buildTimeGreetingSystemNote()}`;
  }

  if (phoneCaptureActive) {
    const phoneResult = ingestPhoneUtterance(state.phoneBuffer, textForLlm);
    state.phoneBuffer = phoneResult.state;
    baseForLock = `${baseForLock}\n\n${phoneResult.systemNote}`;
  }

  state.callFacts = updateCallFactsFromTurn({
    state: state.callFacts,
    userText: textForLlm,
    lastAssistantText: lastAssistantTurn,
    recentAssistantTexts: recentAssistantTexts.slice(-4),
    catalogKnowledge: input.productKnowledge,
  });
  const resolvedName = input.contactName?.trim() || state.callFacts.facts.name;
  const nextCallerGender = inferCallerGender({
    spokenText: textForLlm,
    name: resolvedName,
    previous: state.callerGender,
  });
  state = {
    ...state,
    callerGender: nextCallerGender,
    callFacts:
      nextCallerGender === 'male' || nextCallerGender === 'female'
        ? mergeCallFacts(state.callFacts, { facts: { caller_gender: nextCallerGender } })
        : state.callFacts,
  };
  const factsNote = buildCallFactsSystemNote(state.callFacts);
  if (factsNote) {
    baseForLock = `${baseForLock}\n\n${factsNote}`;
  }

  if (looksLikeNameMissComplaint(textForLlm)) {
    baseForLock = `${baseForLock}\n\n${buildNameRecoverySystemNote()}`;
  }

  if (identityTurn) {
    const leadSource = input.skills.core?.privacy?.leadSourceAnswer?.trim();
    baseForLock = `${baseForLock}\n\n${buildCallPurposeSystemNote(input.productName, {
      leadSourceAnswer: leadSource,
    })}`;
  }

  if (offTopic && !state.wrapForced) {
    baseForLock = `${baseForLock}\n\n${buildOffTopicRedirectSystemNote({
      productName: input.productName,
      strike: state.offTopicStrikes,
      maxRedirects,
      forceAtStrike,
      speechLanguage: effective,
    })}`;
  }

  if (state.wrapForced) {
    baseForLock = `${baseForLock}\n\n${buildWrapLimitSystemNote(input.productName)}`;
  }

  const featuresPricingAsk =
    /\b(features?|feature\s+list|pricing|price|prices|kitna|kitne|cost|plan|plans|advance|deposit|payment\s+kitn)\b|फीचर|प्राइस|कीमत|एडवांस/i;
  if (featuresPricingAsk.test(textForLlm) && directQuestion) {
    baseForLock = `${baseForLock}\n\n${buildFeaturesPricingDirectAnswerNote(input.productName)}`;
  }

  if (isAnswerFirstComplaint(textForLlm) || isDeferBookingAsk(textForLlm)) {
    state.deferBookingTurnsLeft = DEFER_BOOKING_STICKY_TURNS;
    baseForLock = `${baseForLock}\n\n${buildAnswerFirstComplaintNote()}`;
  } else if (state.deferBookingTurnsLeft > 0 && !isClearBookIntent(textForLlm)) {
    state.deferBookingTurnsLeft -= 1;
    baseForLock = `${baseForLock}\n\n${buildDeferBookingSystemNote()}`;
  } else if (isClearBookIntent(textForLlm)) {
    state.deferBookingTurnsLeft = 0;
  }

  if (isFrustratedOrAngryTurn(textForLlm)) {
    const angry = input.skills.angry;
    baseForLock = `${baseForLock}\n\n${buildAngryCallerSystemNote(angry.acknowledge, angry.deescalate)}`;
  }

  const pack = resolvePackForBooking(input.skills.booking);
  const packNote = pack.turnNote
    ? await pack.turnNote({
        text: textForLlm,
        productName: input.productName,
        answerFirst: isAnswerFirstComplaint(textForLlm),
      })
    : null;
  if (packNote) {
    baseForLock = `${baseForLock}\n\n${packNote}`;
  } else if (isProductCatalogHelpAsk(textForLlm)) {
    baseForLock = `${baseForLock}\n\n${buildProductCatalogHelpFirstNote(input.productName)}`;
  }

  if (
    !state.bookingSaved &&
    (looksLikeBookingConfirmed(lastAssistantTurn) ||
      looksLikeBookingConfirmed(state.lastRememberedAssistant))
  ) {
    baseForLock = `${baseForLock}\n\n${buildFakeBookingConfirmSystemNote()}`;
  }

  if (
    input.hasConsumedLeadHistory &&
    isCallerPriorRecallCue(textForLlm)
  ) {
    baseForLock = `${baseForLock}\n\n${buildPriorRecallSystemNote()}`;
  }

  if (outboundNote) {
    baseForLock = `${baseForLock}\n\n${outboundNote}`;
  }

  if (
    input.agentGender &&
    lastAssistantTurn &&
    spokenUsesWrongHinglishGender(lastAssistantTurn, input.agentGender)
  ) {
    baseForLock = `${baseForLock}\n\n${buildHinglishGenderCorrectionNote(input.agentGender)}`;
  }

  baseForLock = `${baseForLock}\n\n${buildCallerGenderSystemNote(state.callerGender, resolvedName)}`;

  const guided = appendLanguageGuidanceIfChanged(
    baseForLock,
    state.languageLock,
    state.softSpeechLanguage,
    state.lastInjectedLanguageKey,
  );
  state.lastInjectedLanguageKey = guided.injectedKey;
  return { kind: 'reply', userContent: guided.content, state, ttsLocale: locale };
}

export const prepareUserTurn = prepareSimulator2UserTurn;
