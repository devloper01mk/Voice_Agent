import type { BookingPolicy } from './booking-policy.js';

export type LlmProvider = 'groq' | 'gpt';

export type SttProvider = 'azure' | 'openai' | 'sarvam' | 'google';

export type AgentGender = 'female' | 'male';

export type SpeakLanguage = 'en' | 'hi' | 'hinglish';

export interface CoreSkillsConfig {
  dnc: { confirmLine: string };
  wrongNumber: { apologizeLine: string };
  gatekeeper: { askScript: string; callbackOffer: string };
  identity: { whoIsCalling: string };
  privacy: { leadSourceAnswer: string; recordingObjection: string };
  humanHandoff: { acknowledge: string };
  detailsChannel: { sendDetailsPromise: string };
  abusive: { boundaryLine: string };
  silence: { checkInLine: string; goodbyeLine: string };
  audioIssue: { checkLine: string; callbackOffer: string };
  voicemail: { messageScript: string };
  ivr: { receptionistScript: string };
}

export interface ComplianceConfig {
  recordingDisclosure: string;
}

export interface RuntimeConfig {
  /** Short spoken ack when caller asks to hold (default "Ji."). */
  holdAckLine: string;
  /** Per-tool filler lines spoken while a slow tool HTTP call runs. */
  toolHoldLines?: Record<string, string>;
  /** Mute agent after exploring/thinking turns for this many ms. */
  exploringSilenceMs: number;
  holdSoftCheckinMs: number;
  silenceFirstPromptSec: number;
  silenceEndSec: number;
  /**
   * How long this agent remembers lead/contact memory across calls (hours).
   * 0 = Off. Presets: 24, 48, 168 (7d), 720 (30d).
   */
  leadMemoryRetentionHours?: number;
}

export interface SkillsConfig {
  angry: {
    acknowledge: string;
    deescalate: string;
  };
  busy: {
    acknowledge: string;
    callbackQuestion: string;
    confirmTemplate: string;
  };
  support: {
    acknowledge: string;
    collectContact: string;
    handoffPromise: string;
  };
  objection: {
    empathyLine: string;
    priceResponse: string;
    excelResponse: string;
    thinkItOverResponse: string;
  };
  discovery: {
    openQuestion: string;
    painProbe: string;
    currentToolsQuestion: string;
  };
  competitor: {
    boundaryTemplate: string;
    pivotQuestion: string;
    demoBridge: string;
  };
  exit: {
    notInterestedLine: string;
    politeClose: string;
  };
  demoOfferScript: string;
  demo?: {
    nameConfirmTemplate?: string;
    nameSpellRetryTemplate?: string;
    phoneConfirmTemplate?: string;
    phoneSpellRetryTemplate?: string;
    knownEmailDomains?: string[];
  };
  unclear?: {
    lineUnclearTemplate?: string;
    intentConfirmTemplate?: string;
  };
  offTopic: {
    refusalTemplate: string;
    personalRefusalTemplate?: string;
    redirectQuestion: string;
    maxRedirects: number;
  };
  timepass: {
    maxCasualTurns: number;
    redirectLine: string;
    exitLine: string;
  };
  /** Universal call-handling playbooks (product-agnostic). */
  core?: CoreSkillsConfig;
  /** Org-level compliance wording. */
  compliance?: ComplianceConfig;
  /** Configurable timers and limits (some also enforced in code). */
  runtime?: RuntimeConfig;
  /**
   * Per-agent save/booking gates. Product facts stay in Brain; process rules here
   * so hotel vs CRM agents can differ without code changes.
   */
  booking?: BookingPolicy;
}
