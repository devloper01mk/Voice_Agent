import type WebSocket from 'ws';
/**
 * Smartflo / Acefone phone call session.
 * Cascaded: Azure STT → LLM → Cartesia TTS.
 * OpenAI Realtime / Gemini Live S2S: optional via telephonySession.appliedPipeline.
 */
import {
  applyProductNameAliases,
  applySuvSttAliases,
  buildOutboundOpenerInstructions,
  buildGeminiLiveS2sInstructionSupplement,
  isGemini31LiveModel,
  preferGeminiLiveModelForTelephony,
  resolveGeminiLiveModel,
  buildRealtimeS2sInstructionSupplement,
  buildCallTimeContextPrompt,
  appendHinglishGenderLock,
  lockSpokenHinglishGender,
  buildSttPhraseList,
  emptySimulator2TurnState,
  getKnownEmailDomains,
  isPoliteEndCue,
  mergeSkillsConfig,
  mergeUserUtterance,
  isSameUtteranceContinuation,
  isNearDuplicateUtterance,
  normalizeHeard,
  markBookingSaved,
  normalizeRealtimeS2sUserConfig,
  normalizeSttProvider,
  prepareSimulator2UserTurn,
  refreshLanguagePrompt,
  rememberSimulator2Assistant,
  resolveSimulator2TtsEmotion,
  isUrgentBargeInCue,
  shouldBargeInOnSpeech,
  shouldSpeculateOnInterim,
  speculativeHeardMatch,
  productKnowledgeFromSources,
  isOutboundAttentionUtterance,
  type CallDirection,
  type RealtimeS2sUserConfig,
  type Simulator2TurnState,
} from '@vsa/shared';
import { hangupSmartfloWithCandidates, looksLikeSmartfloRefId } from './acefone-client.js';
import { isToolHoldEnabled, resolveToolHoldLine } from './tool-hold-lines.js';
import { prisma } from '../db.js';
import {
  azureSpeechOnCooldown,
  isAzureSttQuotaError,
  markAzureSpeechQuota,
  AZURE_SPEECH_QUOTA_HINT,
  isAzureAutodetectFallbackMessage,
  TelephonyPushStt,
  type TelephonySttOptions,
} from './azure-push-stt.js';
import { TelephonyAzureRestStt } from './azure-rest-stt.js';
import { TelephonyGooglePushStt } from './google-push-stt.js';
import { TelephonySarvamPushStt } from './sarvam-push-stt.js';
import {
  isGreetingEchoTranscript,
  isShortNumberSttNoise,
  stripLeadingSttNumberNoise,
} from './stt-listen-filters.js';
import { streamMulaw8kFrames } from './cartesia-telephony-tts.js';
import { emitTelephonyEvent } from './event-bus.js';
import { internalApiUrl } from './internal-api.js';
import {
  fetchRuntimeAgent,
  streamOutboundOpener,
  streamReply,
  takePrefetchedRuntime,
  telephonyLlmLabel,
  type ChatMessage,
  type LlmTextResult,
  type RuntimeAgentPayload,
} from './llm-client.js';
import { getPendingCall, normalizeCallId } from './call-registry.js';
import { readTelephonySessionPayload, resolveTelephonyAppliedPipeline, normalizeTelephonyPipelineMode } from './session-config.js';
import { TelephonyRealtimeClient } from './telephony-realtime-client.js';
import { TelephonyGeminiLiveClient } from './telephony-gemini-live-client.js';
import { TelephonyMetricsAccumulator } from './metrics.js';
import { mulawToPcm16, upsample8kTo16k } from './mulaw.js';
import { getTelephonyLatencyTuning, getSegmentedSttLatencyTuning } from './latency-profile.js';
import { registerCallSession, unregisterCallSession } from './session-registry.js';
import {
  isFastOpenerEnabled,
  resolveScriptedOpener,
  shouldWaitForAmdBeforeOpener,
} from './telephony-opener.js';
import { awaitWarmedOpenerFrames } from './opener-warm.js';
import { takeWarmedTelephonyStt } from './stt-warm.js';
import {
  shouldTelephonyCommitUserTurn,
  telephonyCommitDelayMs,
} from './turn-commit.js';
import {
  buildVoicemailMessage,
  classifyAmdSpeech,
  defaultVoicemailScript,
  isVoicemailDetectionEnabled,
  resolveAmdTimeoutMs,
  resolveVoicemailBeepWaitMs,
} from './voicemail-detection.js';

interface AcefoneStartPayload {
  event: 'start';
  streamSid?: string;
  start?: {
    streamSid?: string;
    callSid?: string;
    from?: string;
    to?: string;
    direction?: string;
    customParameters?: Record<string, string>;
  };
}

interface TranscriptLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

interface SpeakChunk {
  text: string;
  filler: boolean;
}

const SHORT_ACK =
  /^(haan+|ha+|han+|ji+|ok+|okay+|hmm+|hm+|uh+|aa+|theek hai|theek|yes|yeah|achha+|acha+|sahi|bilkul|hmm ji|maam+|madam+|mam+|sir+|hello+|hi+|hey+|हैलो+|नमस्ते|जी+)$/i;
const ACK_TOKEN =
  /^(haan+|ha+|han+|ji+|ok+|okay+|hmm+|hm+|uh+|aa+|theek|hai|yes|yeah|achha+|acha+|sahi|bilkul|maam+|madam+|mam+|sir+|hello+|hi+|hey+|हैलो+|नमस्ते|जी+)$/i;

function normalizeSpeech(text: string): string {
  return text.toLowerCase().replace(/[.,!?'"]/g, '').replace(/\s+/g, ' ').trim();
}

function isShortAck(text: string): boolean {
  const n = normalizeSpeech(text);
  if (SHORT_ACK.test(n)) return true;
  const words = n.split(' ').filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.every((w) => ACK_TOKEN.test(w));
}

function isSpeakableTts(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pcmAvgEnergy(pcm: Buffer): number {
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
  return energy / (pcm.length / 2 || 1);
}

const SILENCE_CHECK_IN_MS = 10_000;
const SILENCE_GOODBYE_MS = 45_000;
const LISTEN_ENERGY_THRESHOLD = 250;
const ECHO_TAIL_MS = 200;
/** Keep ~300ms of quieter onset audio so barge-in does not drop the first syllables. */
const BARGE_PREROLL_MS = 300;
/** Minimum time after each TTS sentence before barge-in can fire. Phone echo bleeds into Sarvam. */
const BARGE_ECHO_GUARD_MS = 900;
/** Minimum interrupt energy — echo spikes were 575–3105 after a silent floor. */
const BARGE_MIN_THRESHOLD = 900;
/** Consecutive voiced inbound before energy-cut. Short acks/echo of "Ji" are ~160–200ms — do not chop TTS. */
const BARGE_SUSTAINED_MS = 550;
/** One quiet 100ms Acefone frame must not zero the sustain counter. */
const BARGE_MAX_MISSES = 1;
/** Per-frame decay of the running-max echo floor (~100ms Acefone frames). */
const BARGE_FLOOR_DECAY = 0.95;
/** Keep about one 100ms Acefone frame on the wire so playback does not underrun. */
/** Remote hangup often leaves the media WS open with no inbound frames. */
const DEAD_MEDIA_MS = 8_000;
/** Acefone keeps sending near-zero PCM after the callee hangs up. Room noise is usually higher. */
const DEAD_LINE_ENERGY = 25;
/** Mic mute looks like digital silence; do not treat a short hush as hangup. */
const DEAD_LINE_MS = 45_000;
/** Ignore inbound hush for this long after we cut our own TTS (mute/barge-in). */
const QUIET_GRACE_AFTER_SELF_CUT_MS = 20_000;
/** S2S: ignore energy barge after agent audio starts (learn echo, then allow interrupt). */
const S2S_BARGE_GUARD_MS = 700;
/** S2S: hard cut — sustained above hard threshold before Acefone clear. */
const S2S_BARGE_SUSTAIN_MS = 240;
/** Soft path: stream to Gemini this long before cutting Acefone (faster replies). */
const S2S_EARLY_LISTEN_MS = 160;
/** S2S: absolute minimum energy for hard cut. */
const S2S_BARGE_MIN_THRESHOLD = 1180;
/** Soft listen floor — below this never early-stream (echo). */
const S2S_EARLY_LISTEN_MIN = 1000;
/** Seed EMA baseline when agent starts — phone always returns some TTS echo. */
const S2S_ECHO_FLOOR_SEED = 1650;
/** After a barge, ignore further cuts briefly (prevents silent cut-loop). */
const S2S_BARGE_COOLDOWN_MS = 1_000;
/** Keep recent inbound mulaw while agent talks — flush on barge / agent stop. */
const S2S_LISTEN_PREROLL_MS = 1_400;
/** After caller speech, this much hush → nudge Gemini (audioStreamEnd). */
const S2S_LOCAL_EOU_SILENCE_MS = 130;
/** Min voiced ms before local audioStreamEnd (avoids noise blips → Gemini internal error). */
const S2S_LOCAL_EOU_MIN_SPEECH_MS = 220;
/** EMA adapt rate while learning echo in the guard window. */
const S2S_ECHO_EMA_ALPHA = 0.2;
/**
 * Ignore STT only after hangup-level silence. Azure finals arrive 0.5–2s after
 * the caller stops; 1.2s of hush was dropping real speech like "haan ji boliye".
 */
const DEAD_LINE_IGNORE_STT_MS = DEAD_LINE_MS;
const STT_HALLUCINATION_RE =
  /indian english|latin script|hinglish phone conversation|thanks for watching|please subscribe|hinglish|channels are mixed up/i;
const VOCAB_ONLY_RE =
  /^(?:(?:volkswagen|taigun|tegun|tyagon|tiguan|tuguan|tayron|virtus|hinglish)[\s,./-]*)+$/i;
/** Silence hallucinations before the agent has spoken on outbound. */
const OUTBOUND_SILENCE_THANKS_RE =
  /^(?:धन्यवाद|शुक्रिया|thank\s*you|thanks|dhanyavaad|shukriya)(?:\s+(?:सही|sahi|hai|है))?[.!?।]*$/iu;

export class TelephonyCallSession {
  readonly #ws: WebSocket;
  readonly callId: string;
  #streamSid = '';
  #callSid = '';
  /** Click-to-call Support ref_id (UUID) — hangup API accepts this as ref_id. */
  #acefoneRefId = '';
  #callId = '';
  #agentId = '';
  #agent: RuntimeAgentPayload | null = null;
  #stt: TelephonyPushStt | TelephonyAzureRestStt | TelephonySarvamPushStt | TelephonyGooglePushStt | null = null;
  #sttEngine: 'azure' | 'azure-rest' | 'sarvam' | 'google' | null = null;
  #sttFailingOver = false;
  #sttQuotaNotified = false;
  #history: ChatMessage[] = [];
  #transcript: TranscriptLine[] = [];
  #mediaChunk = 0;
  #speaking = false;
  #processing = false;
  #closed = false;
  #prospectName?: string;
  #contactPhone?: string;
  #contactEmail?: string;
  #metrics = new TelephonyMetricsAccumulator();
  readonly #latency = getTelephonyLatencyTuning();

  #commitTuning() {
    if (this.#sttEngine === 'sarvam' || this.#sttEngine === 'google') {
      return getSegmentedSttLatencyTuning(this.#latency.profile);
    }
    return this.#latency;
  }

  #usesSegmentedStt(): boolean {
    return this.#sttEngine === 'sarvam' || this.#sttEngine === 'google';
  }
  #turnState: Simulator2TurnState = emptySimulator2TurnState();
  #callDirection: CallDirection = 'outbound';
  #ttsLanguage: 'en' | 'hi' | null = null;
  #listenStartedAt = 0;
  #connectedAt = 0;
  #lastUserFinalAt = 0;
  /** Last committed Sarvam/Google segment text — blocks duplicate/overlap commits. */
  #lastSegmentCommitText = '';
  #lastSegmentCommitAt = 0;
  #mediaCount = 0;
  #mediaLogged = 0;
  #pendingUserText: string | null = null;
  #lastInterim = '';
  #audioQueue: Buffer[] = [];
  #loggedMediaShape = false;
  #interrupted = false;
  /** Bumps on barge-in and each new spoken turn so leftover TTS pumps cannot resume. */
  #speakGen = 0;
  #speakStartedAt = 0;
  #currentAgentText = '';
  #playbackUntil = 0;
  #audioStartedAt = 0;
  #sentAudioMs = 0;
  #listenHadEnergy = false;
  #checkInDone = false;
  #silenceCheckTimer: ReturnType<typeof setTimeout> | undefined;
  #silenceGoodbyeTimer: ReturnType<typeof setTimeout> | undefined;
  #lastSilenceNudgeAt = 0;
  #echoMuteUntil = 0;
  /** When false, leftover S2S audio frames are dropped after barge-in. */
  #realtimePlaybackOpen = true;
  /** Sustained inbound energy while S2S agent is speaking (local barge-in). */
  #realtimeBargeEnergyMs = 0;
  /** Soft early-listen sustain while agent speaks (stream to Gemini, no Acefone cut yet). */
  #s2sEarlyListenMs = 0;
  /** While mic is open: local end-of-utterance tracking for faster Gemini replies. */
  #s2sOpenMicHadSpeech = false;
  #s2sOpenMicSpeechMs = 0;
  #s2sOpenMicSilenceMs = 0;
  #s2sOpenMicEouSent = false;
  /** EMA of inbound energy while agent talks — tracks echo plateau, not peaks. */
  #s2sEchoBaseline = 0;
  /** Echo baseline frozen after guard so interrupt spikes stay detectable. */
  #s2sEchoBaselineFrozen = 0;
  /** Peak inbound energy during guard — freeze uses this so loud TTS echo does not false-barge. */
  #s2sEchoPeak = 0;
  /** Mulaw frames captured while agent spoke — flushed on barge or when agent stops. */
  #s2sListenBuf: Buffer[] = [];
  #s2sListenBufMs = 0;
  #s2sListenHadSpeech = false;
  /** Wall-clock until which local S2S barge is ignored (stops echo cut-loop). */
  #s2sBargeCooldownUntil = 0;
  #bargeEnergyMs = 0;
  #bargeMisses = 0;
  #bargeEchoFloor = 0;
  #bargePcmQueue: Buffer[] = [];
  #bargePreRoll: Buffer[] = [];
  #bargePreRollMs = 0;
  #duplexSttActive = false;
  #hasInboundTrack = false;
  #lastPlayingEnergyLogAt = 0;
  #hangupSent = false;
  #pendingRealtimeHangupReason: string | null = null;
  #pendingRealtimeHangupTimer: ReturnType<typeof setTimeout> | undefined;
  #lastInboundAt = 0;
  #lastVoicedAt = 0;
  #quietMs = 0;
  #quietGraceUntil = 0;
  #deadMediaTimer: ReturnType<typeof setTimeout> | undefined;
  #turnAbort: AbortController | null = null;
  /** Bumped when a committed reply is aborted so leftover finally blocks do not double-fire. */
  #turnEpoch = 0;
  #heardBuf = '';
  #heardDurationMs = 0;
  #lastSttAt = 0;
  #commitTimer: ReturnType<typeof setTimeout> | undefined;
  #speculateTimer: ReturnType<typeof setTimeout> | undefined;
  #speculateAbort: AbortController | null = null;
  #speculatedHeard = '';
  #speculatedSentences: string[] = [];
  #speculatedReply: LlmTextResult | null = null;
  #speculatePromise: Promise<LlmTextResult> | null = null;
  #speculateOnSentence: ((sentence: string) => void) | null = null;
  #committedHeard = '';
  /** Live user transcript line id — fold updates this row instead of appending a snowball. */
  #openUserLineId: string | null = null;
  /** Concat of finalized user lines — strip if Gemini resends cumulative history. */
  #committedUserTranscript = '';
  /** Live agent transcript line id for S2S streaming updates. */
  #openAgentLineId: string | null = null;
  #amdActive = false;
  #amdHeard = '';
  #amdTimer: ReturnType<typeof setTimeout> | undefined;
  #amdResolve: ((result: 'human' | 'voicemail') => void) | undefined;
  /** Prevents duplicate Smartflo `start` events from replaying AMD + opener. */
  #pipelineStarted = false;
  /** Outbound opener in flight — pickup hello must not abort it or commit as a user turn. */
  #outboundOpenerArming = false;
  #outboundOpenerDelivered = false;
  #useRealtimeS2s = false;
  #realtime: TelephonyRealtimeClient | TelephonyGeminiLiveClient | null = null;
  #realtimeAwaitingOpener = false;
  #realtimeOpenerRetried = false;

  constructor(ws: WebSocket, callId: string) {
    this.#ws = ws;
    this.callId = callId;
    this.#callId = callId;
    registerCallSession(callId, this);
  }

  get callSid(): string {
    return this.#callSid;
  }

  emitLog(
    level: 'info' | 'warn' | 'error',
    message: string,
    detail?: unknown,
    category = 'pipeline',
  ): void {
    emitTelephonyEvent(this.#callId, { type: 'log', level, category, message, detail });
  }

  async handleMessage(raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const event = msg.event;
    if (event === 'connected') {
      this.emitLog('info', 'Smartflo connected event', undefined, 'ws');
      return;
    }

    if (event === 'start') {
      void this.#onStart(msg as unknown as AcefoneStartPayload).catch((err) => {
        const message = err instanceof Error ? err.message : 'start failed';
        console.error('[telephony] onStart failed', err);
        this.emitLog('error', message);
      });
      return;
    }

    if (event === 'media') {
      this.#onMedia(msg);
      return;
    }

    if (event === 'mark') {
      this.#playbackUntil = Date.now();
      return;
    }

    if (
      event === 'stop' ||
      event === 'hangup' ||
      event === 'disconnect' ||
      event === 'disconnected' ||
      event === 'close'
    ) {
      this.emitLog('info', `Smartflo ${String(event)} event — ending call`, undefined, 'ws');
      await this.requestHangup(`smartflo_${String(event)}`);
      return;
    }

    if (typeof event === 'string') {
      this.emitLog('info', `Smartflo event: ${event}`, undefined, 'ws');
    }
  }

  async #onStart(msg: AcefoneStartPayload): Promise<void> {
    if (this.#pipelineStarted) {
      this.emitLog('warn', 'Ignoring duplicate Smartflo start event', {
        streamSid: msg.streamSid ?? msg.start?.streamSid,
        callSid: msg.start?.callSid,
      }, 'smartflo');
      return;
    }
    this.#pipelineStarted = true;
    this.#connectedAt = Date.now();
    this.#streamSid = (msg.streamSid ?? msg.start?.streamSid ?? '') as string;
    this.#callSid = msg.start?.callSid ?? '';
    const direction = msg.start?.direction ?? 'outbound';
    this.#callDirection = direction === 'inbound' ? 'inbound' : 'outbound';

    this.emitLog('info', 'Smartflo start event', {
      streamSid: this.#streamSid,
      callSid: this.#callSid,
      from: msg.start?.from,
      to: msg.start?.to,
      direction,
      customKeys: msg.start?.customParameters
        ? Object.keys(msg.start.customParameters)
        : [],
    }, 'smartflo');

    this.#sendKeepaliveAudio(3);

    const call = await this.#findCall();
    if (!call) {
      this.emitLog('error', `Call not found in database: ${this.#callId}`, undefined, 'pipeline');
      emitTelephonyEvent(this.#callId, {
        type: 'error',
        message: `Call not found: ${this.#callId}`,
      });
      return;
    }
    this.#callId = call.id;
    this.#agentId = call.agentId;
    registerCallSession(call.id, this);

    if (call.externalCallId && looksLikeSmartfloRefId(call.externalCallId)) {
      this.#acefoneRefId = call.externalCallId;
    }

    this.#prospectName = call.prospectName ?? undefined;
    this.#contactPhone = call.contactPhone ?? undefined;
    this.#contactEmail = call.contactEmail ?? undefined;

    void prisma.call.update({
      where: { id: call.id },
      data: {
        status: 'in-progress',
        // Prefer live callSid for later hangup; keep prior ref_id in #acefoneRefId.
        externalCallId: this.#callSid || call.externalCallId || undefined,
        fromNumber: msg.start?.from ?? call.fromNumber ?? undefined,
        toNumber: msg.start?.to ?? call.toNumber ?? undefined,
      },
    }).catch(() => undefined);
    emitTelephonyEvent(this.#callId, { type: 'status', status: 'in-progress' });
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });

    try {
      const runtimeOpts = {
        prospectName: call.prospectName ?? undefined,
        contactPhone: call.contactPhone ?? undefined,
        contactEmail: call.contactEmail ?? undefined,
        direction: (direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
      };
      const prefetched = takePrefetchedRuntime(call.id);
      this.#agent = prefetched
        ? await prefetched.catch(() => fetchRuntimeAgent(call.agentId, runtimeOpts))
        : await fetchRuntimeAgent(call.agentId, runtimeOpts);
      const telephonySession = readTelephonySessionPayload(call.transcript);
      const pending = getPendingCall(call.id);
      const pipelineMode = normalizeTelephonyPipelineMode(
        telephonySession?.pipelineMode ?? pending?.voicePipeline ?? 'agent',
      );
      const agentRow = await prisma.agent.findUnique({
        where: { id: call.agentId },
        select: { voicePipeline: true, realtimeVoice: true },
      });
      const appliedPipeline =
        telephonySession?.appliedPipeline ??
        resolveTelephonyAppliedPipeline(pipelineMode, agentRow?.voicePipeline);
      this.#useRealtimeS2s =
        appliedPipeline === 'openai_realtime' || appliedPipeline === 'gemini_live';

      this.emitLog('info', `Agent loaded: ${this.#agent.name}`, {
        llm: telephonyLlmLabel(this.#agent),
        prefetched: Boolean(prefetched),
        voicePipeline: appliedPipeline,
        pipelineMode,
        realtimeVoice: this.#useRealtimeS2s
          ? telephonySession?.realtimeS2sConfig?.voice ?? agentRow?.realtimeVoice
          : undefined,
      });

      if (this.#useRealtimeS2s) {
        await this.#startRealtimePipeline(
          telephonySession?.realtimeS2sConfig ?? {
            voice: agentRow?.realtimeVoice ?? undefined,
          },
          direction === 'inbound' ? 'inbound' : 'outbound',
          appliedPipeline === 'gemini_live' ? 'gemini_live' : 'openai_realtime',
        );
        return;
      }

      this.#startStt();

      if (direction === 'outbound') {
        const useScriptedOpener = isFastOpenerEnabled() && Boolean(this.#agent!.greeting?.trim());
        const waitAmd = shouldWaitForAmdBeforeOpener(this.#agent!);

        if (useScriptedOpener && !waitAmd) {
          this.#outboundOpenerArming = true;
          let opener: LlmTextResult | null = null;
          try {
            opener = await this.#playScriptedOutboundOpener();
            this.emitLog('info', 'Scripted outbound opener (instant path)', undefined, 'pipeline');
          } finally {
            this.#outboundOpenerArming = false;
            this.#outboundOpenerDelivered = this.#transcript.some((line) => line.role === 'agent');
          }
          void this.#runOutboundAmd().then(async (amd) => {
            if (amd === 'voicemail' && !this.#closed) {
              await this.#leaveVoicemailMessage();
            }
          });
          if (opener?.text) {
            this.#history.push({ role: 'assistant', content: opener.text });
            this.#turnState = rememberSimulator2Assistant(this.#turnState, opener.text);
          }
        } else {
          const amd = await this.#runOutboundAmd();
          if (amd === 'voicemail') {
            await this.#leaveVoicemailMessage();
            return;
          }

          this.#outboundOpenerArming = true;
          let opener: LlmTextResult | null = null;
          try {
            opener = await this.#runSpokenTurn(
              useScriptedOpener
                ? async () => ({
                    text: resolveScriptedOpener(this.#agent!, this.#prospectName),
                    usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 },
                  })
                : (hooks) =>
                    streamOutboundOpener(this.#agent!, this.#prospectName, {
                      ...hooks,
                      promptCacheKey: this.#callId,
                    }),
              { opener: true, scripted: useScriptedOpener },
            );
            if (useScriptedOpener) {
              this.emitLog('info', 'Scripted outbound opener (fast path)', undefined, 'pipeline');
            }
          } finally {
            this.#outboundOpenerArming = false;
            this.#outboundOpenerDelivered = this.#transcript.some((line) => line.role === 'agent');
          }
          if (opener?.text) {
            this.#history.push({ role: 'assistant', content: opener.text });
            this.#turnState = rememberSimulator2Assistant(this.#turnState, opener.text);
          }
        }
      } else {
        emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
        this.#listenStartedAt = Date.now();
        this.#scheduleSilenceWatch();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'onStart pipeline failed';
      console.error('[telephony] onStart pipeline failed', err);
      this.emitLog('error', message);
      emitTelephonyEvent(this.#callId, { type: 'error', message });
      if (/gemini live|realtime|GEMINI_API_KEY|setup timeout/i.test(message)) {
        void this.requestHangup('s2s_connect_failed');
        return;
      }
      if (this.#agent) {
        try {
          await this.#runSpokenTurn(async () => ({
            text: this.#agent!.greeting || 'Hello.',
            usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 },
          }));
        } catch (fallbackErr) {
          console.error('[telephony] fallback greeting failed', fallbackErr);
        }
      }
    }
  }

  #sttOptions(): TelephonySttOptions {
    return {
      languages: this.#agent?.voiceLanguages,
      onInterim: (text) => this.#onInterimSpeech(text),
      onFinal: (text, durationMs) => {
        console.log('[telephony] STT final:', text.slice(0, 120));
        this.#ingestHeard(text, { final: true, durationMs });
      },
      onNoMatch: () => {
        console.log('[telephony] STT no-match (audio, no words)');
        this.emitLog('info', 'STT heard audio but no words (no-match)');
        this.#listenHadEnergy = true;
        this.#nudgeSilenceWatch();
      },
      onError: (message) => {
        if (isAzureAutodetectFallbackMessage(message)) {
          this.emitLog('warn', message, undefined, 'pipeline');
          return;
        }
        const quota = isAzureSttQuotaError(message);
        if (quota && this.#sttEngine === 'azure') {
          console.error('[telephony] STT', message);
          this.emitLog('warn', 'Azure realtime STT quota — switching to Azure REST', undefined, 'pipeline');
          void this.#failoverToAzureRest();
          return;
        }
        if (quota) {
          if (this.#sttQuotaNotified) return;
          this.#sttQuotaNotified = true;
          markAzureSpeechQuota();
          console.error('[telephony] STT', message);
          this.emitLog('error', AZURE_SPEECH_QUOTA_HINT, undefined, 'pipeline');
          emitTelephonyEvent(this.#callId, { type: 'error', message: AZURE_SPEECH_QUOTA_HINT });
          return;
        }
        console.error('[telephony] STT', message);
        this.emitLog('error', `STT: ${message}`, undefined, 'pipeline');
        emitTelephonyEvent(this.#callId, { type: 'error', message });
      },
      onReady: () => {
        if (this.#closed) return;
        const locale = this.#stt?.locale ?? 'en-IN';
        const phrases = this.#sttOptions().phraseList ?? [];
        const phrasePreview = phrases.slice(0, 8).join(', ');
        const engineLabel =
          this.#sttEngine === 'sarvam'
            ? 'Sarvam STT'
            : this.#sttEngine === 'google'
              ? 'Google STT'
            : this.#sttEngine === 'azure-rest'
              ? 'Azure REST STT'
              : 'Azure STT';
        const ready = `${engineLabel} ready (${locale})${
          this.#sttEngine === 'sarvam' || this.#sttEngine === 'google'
            ? ''
            : `; phrases=${phrases.length}${phrasePreview ? ` (${phrasePreview})` : ''}`
        }`;
        console.log(`[telephony] ${ready}`);
        this.emitLog('info', ready);
        this.#flushAudioQueue();
      },
      phraseList: buildSttPhraseList(this.#agent?.productName ?? '', this.#agent?.skillsConfig),
    };
  }

  #startStt(): void {
    const provider = normalizeSttProvider(this.#agent?.sttProvider);
    if (provider === 'sarvam') {
      this.#startSarvamStt();
      return;
    }
    if (provider === 'google') {
      this.#startGoogleStt();
      return;
    }
    if (provider === 'openai') {
      this.emitLog(
        'info',
        'OpenAI STT is Simulator-only — using Azure Speech on phone calls',
        undefined,
        'pipeline',
      );
    }
    if (azureSpeechOnCooldown()) {
      this.#startAzureRestStt('Azure REST STT listening');
      return;
    }
    this.#startAzureStt();
  }

  #startSarvamStt(): void {
    this.#sttEngine = 'sarvam';
    if (this.#tryAdoptWarmedStt('sarvam')) return;
    this.#stt = new TelephonySarvamPushStt(this.#sttOptions(), this.#agent?.sttModel);
    void this.#stt.start().catch((err) => {
      const message = err instanceof Error ? err.message : 'Sarvam STT failed to start';
      this.emitLog('error', message, undefined, 'pipeline');
      emitTelephonyEvent(this.#callId, { type: 'error', message });
    });
  }

  #startGoogleStt(): void {
    this.#sttEngine = 'google';
    if (this.#tryAdoptWarmedStt('google')) return;
    this.#stt = new TelephonyGooglePushStt(this.#sttOptions(), this.#agent?.sttModel);
    void this.#stt.start().catch((err) => {
      const message = err instanceof Error ? err.message : 'Google STT failed to start';
      this.emitLog('error', message, undefined, 'pipeline');
      emitTelephonyEvent(this.#callId, { type: 'error', message });
    });
  }

  #tryAdoptWarmedStt(provider: 'azure' | 'sarvam' | 'google'): boolean {
    const warmed = takeWarmedTelephonyStt(this.#callId);
    if (!warmed || warmed.provider !== provider) {
      if (warmed) void warmed.close();
      return false;
    }
    warmed.adoptHandlers(this.#sttOptions());
    this.#stt = warmed as unknown as TelephonyPushStt | TelephonySarvamPushStt | TelephonyGooglePushStt;
    const label =
      provider === 'sarvam' ? 'Sarvam STT' : provider === 'google' ? 'Google STT' : 'Azure STT';
    this.emitLog('info', `Adopted pre-warmed ${label}`, { locale: warmed.locale }, 'pipeline');
    this.#flushAudioQueue();
    return true;
  }

  #startAzureStt(): void {
    this.#sttEngine = 'azure';
    if (this.#tryAdoptWarmedStt('azure')) return;
    this.#stt = new TelephonyPushStt(this.#sttOptions());
    void this.#stt.start().then(() => {
      if (this.#closed) return;
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Azure STT failed to start';
      if (isAzureSttQuotaError(message)) {
        markAzureSpeechQuota();
        void this.#failoverToAzureRest();
        return;
      }
      this.emitLog('error', message);
      emitTelephonyEvent(this.#callId, { type: 'error', message });
    });
  }

  #startAzureRestStt(readyMessage = 'Azure REST STT listening'): void {
    this.#sttEngine = 'azure-rest';
    this.#stt = new TelephonyAzureRestStt(this.#sttOptions());
    void this.#stt.start().then(() => {
      if (this.#closed || this.#sttEngine !== 'azure-rest') return;
      this.emitLog('info', `${readyMessage} (${this.#stt?.locale ?? 'en-IN'})`);
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Azure REST STT failed to start';
      this.emitLog('error', message);
      emitTelephonyEvent(this.#callId, { type: 'error', message });
    });
  }

  async #failoverToAzureRest(): Promise<void> {
    if (this.#closed || this.#sttFailingOver || this.#sttEngine === 'azure-rest') return;
    this.#sttFailingOver = true;
    markAzureSpeechQuota();
    const old = this.#stt;
    this.#stt = null;
    await old?.close();
    this.#startAzureRestStt('Azure REST STT listening (realtime quota fallback)');
    this.#sttFailingOver = false;
  }

  async #findCall() {
    const pending = getPendingCall(this.#callId);
    const id = pending?.callId ?? this.#callId;

    const call = await prisma.call.findUnique({ where: { id } });
    if (call) return call;

    const normalized = normalizeCallId(id);
    const recent = await prisma.call.findMany({
      where: { status: { in: ['initiating', 'ringing', 'in-progress'] } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return recent.find((c) => normalizeCallId(c.id) === normalized) ?? null;
  }

  #sendKeepaliveAudio(chunks = 3): void {
    const silence = Buffer.alloc(160, 0xff);
    for (let i = 0; i < chunks; i++) {
      this.#mediaChunk += 1;
      this.#send({
        event: 'media',
        streamSid: this.#streamSid,
        media: {
          payload: silence.toString('base64'),
          chunk: String(this.#mediaChunk),
        },
      });
    }
  }

  #flushAudioQueue(): void {
    if (!this.#stt?.ready) return;
    for (const chunk of this.#audioQueue) {
      this.#stt.pushPcm16_16k(chunk);
    }
    if (this.#audioQueue.length) {
      this.emitLog('info', `Flushed ${this.#audioQueue.length} queued audio chunks into STT`);
    }
    this.#audioQueue = [];
  }

  #onMedia(msg: Record<string, unknown>): void {
    if (this.#closed) return;
    const media = msg.media as { payload?: string; track?: string } | undefined;
    const track = media?.track?.toLowerCase();
    if (track === 'inbound') this.#hasInboundTrack = true;
    // Acefone samples have no track. Only ignore outbound echo after a real inbound track appears.
    if (track === 'outbound' && this.#hasInboundTrack) return;

    if (!this.#loggedMediaShape) {
      this.#loggedMediaShape = true;
      const firstMedia = {
        keys: Object.keys(msg),
        mediaKeys: media && typeof media === 'object' ? Object.keys(media) : [],
        track: track ?? 'unspecified',
        payloadType: typeof media?.payload,
        payloadLen: typeof media?.payload === 'string' ? media.payload.length : 0,
        sttReady: Boolean(this.#stt?.ready),
      };
      console.log('[telephony] First media event', firstMedia);
      this.emitLog('info', 'First media event', firstMedia, 'ws');
    }

    const payload = media?.payload;
    if (!payload || typeof payload !== 'string') return;
    this.#noteInboundMedia();

    this.#mediaCount += 1;
    const mulaw = Buffer.from(payload, 'base64');
    const pcm8k = mulawToPcm16(mulaw);
    const energy = pcmAvgEnergy(pcm8k);
    const frameMs = (pcm8k.byteLength / 2 / 8000) * 1000;

    if (this.#useRealtimeS2s) {
      this.#onMediaRealtime(mulaw, energy, frameMs);
      return;
    }

    const pcm16k = upsample8kTo16k(pcm8k);
    if (this.#trackQuietHangup(energy, frameMs)) return;
    // Do not drop media on quiet "dead line" — soft speech must still reach STT.
    // Hallucinated finals on a dead line are filtered in #onUserSpeech instead.

    if (this.#isAgentPlaying()) {
      this.#maybeEnergyBargeIn(energy, frameMs);
      const now = Date.now();
      if (now - this.#lastPlayingEnergyLogAt >= 500) {
        this.#lastPlayingEnergyLogAt = now;
        const msgLine = `playing energy=${Math.round(energy)} floor=${Math.round(this.#bargeEchoFloor)} thresh=${Math.round(this.#bargeThreshold())} voicedMs=${Math.round(this.#bargeEnergyMs)}`;
        if (process.env.TELEPHONY_DEBUG === '1') {
          console.log('[telephony]', msgLine);
          this.emitLog('info', msgLine, undefined, 'pipeline');
        }
      }
      if (this.#isAgentPlaying()) {
        this.#holdBargePcm(pcm16k, energy);
        if (this.#bargeArmed()) {
          if (!this.#duplexSttActive) {
            this.#flushBargePcm();
            this.#duplexSttActive = true;
          }
          this.#pushInboundToStt(pcm16k);
        }
        return;
      }
      this.#flushBargePcm();
      this.#duplexSttActive = false;
    } else {
      this.#bargeEnergyMs = 0;
      this.#bargeMisses = 0;
      this.#clearBargeAudio();
      this.#duplexSttActive = false;
    }

    if (energy >= LISTEN_ENERGY_THRESHOLD) {
      this.#listenHadEnergy = true;
      this.#lastVoicedAt = Date.now();
      this.#nudgeSilenceWatch();
      // Do not re-arm commit or fold the LLM on energy — Acefone hiss resets the
      // timer and aborts thinking, which feels like the agent froze after you spoke.
    }

    // Residual TTS echo after playback — do not feed STT.
    if (Date.now() < this.#echoMuteUntil) {
      return;
    }

    if (this.#mediaCount === 1 || this.#mediaCount - this.#mediaLogged >= 50) {
      this.#mediaLogged = this.#mediaCount;
      this.emitLog('info', `Inbound audio chunks=${this.#mediaCount} bytes=${mulaw.length} energy=${Math.round(energy)}`, {
        track: track ?? 'unspecified',
        speaking: this.#speaking,
        sttReady: Boolean(this.#stt?.ready),
      }, 'ws');
    }

    if (!this.#stt?.ready) {
      this.#audioQueue.push(pcm16k);
      if (this.#audioQueue.length > 400) this.#audioQueue.shift();
      return;
    }

    this.#pushInboundToStt(pcm16k);
  }

  #pushInboundToStt(pcm16k: Buffer): void {
    if (!this.#stt?.ready) {
      this.#audioQueue.push(pcm16k);
      if (this.#audioQueue.length > 400) this.#audioQueue.shift();
      return;
    }
    this.#stt.pushPcm16_16k(pcm16k);
    if (!this.#listenStartedAt) this.#listenStartedAt = Date.now();
  }

  #noteInboundMedia(): void {
    this.#lastInboundAt = Date.now();
    this.#armDeadMediaWatch();
  }

  #armDeadMediaWatch(): void {
    if (this.#deadMediaTimer) clearTimeout(this.#deadMediaTimer);
    this.#deadMediaTimer = setTimeout(() => {
      void this.#onDeadMedia();
    }, DEAD_MEDIA_MS);
  }

  #clearDeadMediaWatch(): void {
    if (this.#deadMediaTimer) clearTimeout(this.#deadMediaTimer);
    this.#deadMediaTimer = undefined;
  }

  async #onDeadMedia(): Promise<void> {
    this.#deadMediaTimer = undefined;
    if (this.#closed) return;
    const idle = Date.now() - this.#lastInboundAt;
    if (idle < DEAD_MEDIA_MS) {
      this.#armDeadMediaWatch();
      return;
    }
    if (this.#isAgentPlaying()) {
      this.#armDeadMediaWatch();
      return;
    }
    this.emitLog('info', `No inbound audio for ${Math.round(idle)}ms — treating as remote hangup`);
    // Must call Smartflo hangup — #onStop alone marks UI completed while the PSTN leg can stay up.
    await this.requestHangup('dead_media');
  }

  /** Acefone keeps sending silence frames after the callee hangs up. Count quiet, not missing frames. */
  #trackQuietHangup(energy: number, frameMs: number): boolean {
    if (this.#closed) return true;
    if (this.#isAgentPlaying() || this.#processing) {
      this.#quietMs = 0;
      return false;
    }
    if (Date.now() < this.#quietGraceUntil) {
      this.#quietMs = 0;
      return false;
    }
    if (energy >= DEAD_LINE_ENERGY) {
      this.#quietMs = 0;
      return false;
    }
    this.#quietMs += frameMs;
    if (!this.#speakStartedAt || this.#quietMs < DEAD_LINE_MS) return false;
    this.emitLog('info', `Inbound quiet for ${Math.round(this.#quietMs)}ms after remote hangup — ending call`);
    this.#quietMs = 0;
    void this.requestHangup('remote_quiet');
    return true;
  }

  #isDeadLine(): boolean {
    const now = Date.now();
    if (this.#lastVoicedAt > 0 && now - this.#lastVoicedAt < 4_000) return false;
    return this.#quietMs >= DEAD_LINE_IGNORE_STT_MS;
  }

  #looksLikeEcho(text: string): boolean {
    const agent = normalizeSpeech(this.#currentAgentText);
    const user = normalizeSpeech(text);
    if (!agent || !user || user.length < 4) return false;
    if (agent.includes(user) || user.includes(agent.slice(0, Math.min(agent.length, user.length)))) {
      return true;
    }
    const words = user.split(' ').filter((w) => w.length >= 4);
    return words.length > 0 && words.length <= 4 && words.every((w) => agent.includes(w));
  }

  #isAgentPlaying(): boolean {
    return !this.#interrupted && (this.#speaking || Date.now() < this.#playbackUntil);
  }

  #bargeThreshold(): number {
    const floor = Math.max(LISTEN_ENERGY_THRESHOLD, this.#bargeEchoFloor);
    return Math.max(floor * 2.5, floor + 700, BARGE_MIN_THRESHOLD);
  }

  #bargeArmed(): boolean {
    const sinceSpeak = this.#speakStartedAt ? Date.now() - this.#speakStartedAt : 0;
    return sinceSpeak >= BARGE_ECHO_GUARD_MS;
  }

  #updateEchoFloor(energy: number, candidateSpeech: boolean): void {
    const decayed = this.#bargeEchoFloor * BARGE_FLOOR_DECAY;
    if (candidateSpeech) {
      this.#bargeEchoFloor = decayed;
      return;
    }
    this.#bargeEchoFloor = Math.max(decayed, energy);
  }

  #maybeEnergyBargeIn(energy: number, frameMs: number): void {
    // Sarvam/Google STT handles barge-in; phone echo often trips energy-only cuts.
    if (this.#usesSegmentedStt()) return;
    if (!this.#isAgentPlaying()) return;
    if (!this.#bargeArmed()) {
      this.#updateEchoFloor(energy, false);
      this.#bargeEnergyMs = 0;
      this.#bargeMisses = 0;
      return;
    }

    const threshold = this.#bargeThreshold();
    if (energy >= threshold) {
      this.#updateEchoFloor(energy, true);
      this.#bargeMisses = 0;
      this.#bargeEnergyMs += frameMs;
      if (this.#bargeEnergyMs >= BARGE_SUSTAINED_MS) {
        this.#bargeIn(
          `energy=${Math.round(energy)} floor=${Math.round(this.#bargeEchoFloor)} for ${Math.round(this.#bargeEnergyMs)}ms`,
        );
      }
      return;
    }

    this.#updateEchoFloor(energy, false);
    if (this.#bargeEnergyMs <= 0) return;
    this.#bargeMisses += 1;
    if (this.#bargeMisses > BARGE_MAX_MISSES) {
      this.#bargeEnergyMs = 0;
      this.#bargeMisses = 0;
      this.#clearBargeAudio();
    }
  }

  #pcm16FrameMs(pcm16k: Buffer): number {
    return (pcm16k.byteLength / 2 / 16_000) * 1000;
  }

  #clearBargeAudio(): void {
    this.#bargePcmQueue = [];
    this.#bargePreRoll = [];
    this.#bargePreRollMs = 0;
  }

  #holdBargePcm(pcm16k: Buffer, energy: number): void {
    if (!this.#bargeArmed()) {
      this.#clearBargeAudio();
      return;
    }
    const frameMs = this.#pcm16FrameMs(pcm16k);
    if (energy >= LISTEN_ENERGY_THRESHOLD) {
      const copy = Buffer.from(pcm16k);
      this.#bargePreRoll.push(copy);
      this.#bargePreRollMs += frameMs;
      while (this.#bargePreRollMs > BARGE_PREROLL_MS && this.#bargePreRoll.length > 1) {
        const dropped = this.#bargePreRoll.shift()!;
        this.#bargePreRollMs -= this.#pcm16FrameMs(dropped);
      }
      if (energy >= this.#bargeThreshold()) {
        this.#bargePcmQueue.push(copy);
        const maxFrames = Math.ceil(BARGE_SUSTAINED_MS / 20) + 4;
        if (this.#bargePcmQueue.length > maxFrames) this.#bargePcmQueue.shift();
      }
    }
  }

  #flushBargePcm(): void {
    const seen = new Set<Buffer>();
    const queued: Buffer[] = [];
    for (const chunk of [...this.#bargePreRoll, ...this.#bargePcmQueue]) {
      if (seen.has(chunk)) continue;
      seen.add(chunk);
      queued.push(chunk);
    }
    this.#clearBargeAudio();
    if (!queued.length) return;
    if (!this.#stt?.ready) {
      this.#audioQueue.push(...queued);
      if (this.#audioQueue.length > 400) {
        this.#audioQueue.splice(0, this.#audioQueue.length - 400);
      }
      return;
    }
    for (const chunk of queued) this.#stt.pushPcm16_16k(chunk);
  }

  #shouldBargeIn(text: string): boolean {
    if (!this.#isAgentPlaying()) return false;
    if (isShortAck(text) || this.#looksLikeEcho(text) || this.#isPhantomTranscript(text)) return false;
    if (this.#speakStartedAt && Date.now() - this.#speakStartedAt < BARGE_ECHO_GUARD_MS) return false;
    if (isUrgentBargeInCue(text)) return true;
    // Sarvam/Google segment finals often include echo bleed — skip broad 4-word barge.
    if (this.#usesSegmentedStt()) return false;
    return shouldBargeInOnSpeech(text);
  }

  #bargeIn(reason: string): void {
    if (this.#interrupted || !this.#isAgentPlaying()) return;
    this.#cutSpeech(reason);
  }

  #isPhantomTranscript(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (isShortNumberSttNoise(trimmed)) return true;
    if (STT_HALLUCINATION_RE.test(trimmed) || VOCAB_ONLY_RE.test(trimmed)) return true;
    if (/[áéíóúýðþæö]/i.test(trimmed)) return true;
    if (
      this.#callDirection === 'outbound' &&
      !this.#outboundOpenerDelivered &&
      OUTBOUND_SILENCE_THANKS_RE.test(trimmed)
    ) {
      return true;
    }
    if (isGreetingEchoTranscript(trimmed, this.#speakStartedAt, Date.now(), {
      playing: this.#isAgentPlaying(),
    })) return true;
    return false;
  }

  #isOutboundPickupGreeting(text: string): boolean {
    return isOutboundAttentionUtterance(text);
  }

  #onInterimSpeech(text: string): void {
    if (this.#isDeadLine()) return;
    if (text === this.#lastInterim) return;
    this.#lastInterim = text;
    this.#ingestHeard(text, { final: false });
  }

  #ingestHeard(text: string, opts: { final: boolean; durationMs?: number }): void {
    if (this.#closed || !this.#agent) return;
    if (this.#isDeadLine()) {
      if (opts.final) {
        console.log('[telephony] Ignored STT on dead line:', text.slice(0, 60));
        this.emitLog('info', `Ignored STT on dead line: ${text.slice(0, 60)}`);
      }
      return;
    }
    const raw = stripLeadingSttNumberNoise(text);
    const recent = this.#transcript.slice(-6).map((line) => line.text);
    const aliased = applySuvSttAliases(
      applyProductNameAliases(raw, this.#agent.productName),
      recent,
      this.#agent.productName,
    );
    if (STT_HALLUCINATION_RE.test(aliased) || this.#isPhantomTranscript(aliased) || this.#looksLikeEcho(aliased)) {
      if (opts.final) {
        const why = isGreetingEchoTranscript(aliased, this.#speakStartedAt, Date.now(), {
          playing: this.#isAgentPlaying(),
        })
          ? 'greeting echo'
          : 'noise/echo';
        this.emitLog(
          'info',
          `Ignored STT ${why}: raw="${raw.slice(0, 60)}" aliased="${aliased.slice(0, 60)}"`,
        );
      }
      return;
    }
    if (this.#isAgentPlaying() && (isShortAck(aliased) || this.#looksLikeEcho(aliased))) {
      if (opts.final) this.emitLog('info', `Ignored mid-speech ack/echo: ${aliased.slice(0, 40)}`);
      return;
    }

    if (this.#amdActive) {
      void this.#handleAmdSpeech(aliased, opts.final);
      return;
    }

    if (this.#outboundOpenerArming && this.#isOutboundPickupGreeting(aliased)) {
      if (opts.final) {
        this.emitLog('info', `Ignored pickup greeting during opener: ${aliased.slice(0, 60)}`);
      }
      return;
    }

    if (this.#processing || this.#isAgentPlaying()) {
      if (this.#committedHeard) {
        const na = normalizeHeard(this.#committedHeard);
        const nb = normalizeHeard(aliased);
        if (na && nb) {
          if (na === nb) {
            if (opts.final) {
              this.emitLog('info', `Ignored duplicate STT after commit: ${aliased.slice(0, 60)}`);
            }
            return;
          }
          if (na.startsWith(nb) && nb.length < na.length) {
            if (opts.final) {
              this.emitLog('info', `Ignored stale STT prefix after commit: ${aliased.slice(0, 60)}`);
            }
            return;
          }
          if (
            this.#usesSegmentedStt() &&
            this.#processing &&
            !this.#isAgentPlaying() &&
            nb.startsWith(na) &&
            nb.length > na.length
          ) {
            this.#holdSttDuringReply(aliased, opts, 'Hold cumulative STT during reply prep');
            return;
          }
        }
      }
      if (this.#shouldFoldContinuation(aliased)) {
        if (this.#isAgentPlaying()) {
          if (opts.final) this.emitLog('info', `Ignored late STT while speaking: ${aliased.slice(0, 60)}`);
          return;
        }
        this.#foldContinuation(opts.final ? `still talking: ${aliased.slice(0, 60)}` : `interim while reply: ${aliased.slice(0, 60)}`);
      } else if (this.#isAgentPlaying()) {
        if (this.#shouldBargeIn(aliased) && !this.#interrupted) {
          this.#cutSpeech(`Prospect: ${aliased}`);
          this.#heardBuf = '';
          this.#committedHeard = '';
          this.#openUserLineId = null;
        } else if (!this.#interrupted) {
          if (opts.final) {
            this.#heardBuf = mergeUserUtterance(this.#heardBuf, aliased);
            this.#lastSttAt = Date.now();
            this.emitLog('info', `Hold STT until agent finishes: ${aliased.slice(0, 60)}`);
          }
          return;
        }
      } else {
        if (this.#outboundOpenerArming && this.#isOutboundPickupGreeting(aliased)) {
          if (opts.final) {
            this.emitLog('info', `Ignored pickup greeting during opener LLM: ${aliased.slice(0, 60)}`);
          }
          return;
        }
        if (this.#usesSegmentedStt()) {
          this.#holdSttDuringReply(aliased, opts, 'Hold STT during reply prep');
          return;
        }
        this.#abandonPrematureTurn(aliased);
      }
    }

    this.#heardBuf = mergeUserUtterance(this.#heardBuf, aliased);
    if (opts.final && opts.durationMs) {
      this.#heardDurationMs = Math.max(this.#heardDurationMs, opts.durationMs);
    }
    if (!this.#listenStartedAt) this.#listenStartedAt = Date.now();
    this.#lastSttAt = Date.now();
    this.#nudgeSilenceCheckIn();
    if (!opts.final) {
      emitTelephonyEvent(this.#callId, {
        type: 'log',
        level: 'info',
        category: 'pipeline',
        message: `Hearing: ${this.#heardBuf.slice(0, 80)}`,
      });
    }
    this.#armCommit();
    this.#maybeSpeculate();
  }

  #holdSttDuringReply(
    aliased: string,
    opts: { final?: boolean; durationMs?: number },
    reason: string,
  ): void {
    this.#heardBuf = mergeUserUtterance(this.#heardBuf, aliased);
    if (opts.final && opts.durationMs) {
      this.#heardDurationMs = Math.max(this.#heardDurationMs, opts.durationMs);
    }
    this.#lastSttAt = Date.now();
    if (opts.final) {
      this.emitLog('info', `${reason}: ${aliased.slice(0, 60)}`);
    }
    this.#armCommit();
  }

  #shouldFoldContinuation(text: string): boolean {
    if (!this.#committedHeard) return false;
    const na = normalizeHeard(this.#committedHeard);
    const nb = normalizeHeard(text);
    if (na && nb && na === nb) return false;
    if (this.#usesSegmentedStt()) return false;
    return isSameUtteranceContinuation(this.#committedHeard, text, {
      msSinceCommit: Date.now() - this.#lastUserFinalAt,
    });
  }

  #cutSpeech(reason: string): void {
    if (this.#interrupted && !this.#isAgentPlaying()) return;
    if (!this.#duplexSttActive) this.#flushBargePcm();
    this.#interrupted = true;
    this.#speakGen += 1;
    this.#duplexSttActive = false;
    this.#speaking = false;
    this.#playbackUntil = 0;
    this.#bargeEnergyMs = 0;
    this.#bargeMisses = 0;
    this.#echoMuteUntil = 0;
    this.#listenStartedAt = Date.now();
    this.#quietMs = 0;
    this.#quietGraceUntil = Date.now() + QUIET_GRACE_AFTER_SELF_CUT_MS;
    this.#send({ event: 'clear', streamSid: this.#streamSid });
    this.#turnAbort?.abort();
    this.#abortSpeculate();
    this.#turnState = { ...this.#turnState, callerInterrupted: true };
    const line = `Barge-in — agent stopped. ${reason.slice(0, 80)}`;
    console.log('[telephony]', line);
    this.emitLog('info', line);
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
  }

  #foldContinuation(reason: string): void {
    this.#turnEpoch += 1;
    this.#abortSpeculate();
    this.#turnAbort?.abort();
    if (this.#isAgentPlaying()) this.#cutSpeech(reason);
    else {
      this.#interrupted = true;
      this.#speakGen += 1;
      this.#speaking = false;
      this.#playbackUntil = 0;
    }
    this.#processing = false;
    this.#heardBuf = mergeUserUtterance(this.#committedHeard, this.#heardBuf);
    this.#committedHeard = '';
    this.emitLog('info', `Fold continuation — ${reason.slice(0, 80)}`);
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
  }

  #abandonPrematureTurn(incoming: string): void {
    this.#turnEpoch += 1;
    this.#abortSpeculate();
    this.#turnAbort?.abort();
    this.#interrupted = true;
    this.#speakGen += 1;
    this.#speaking = false;
    this.#playbackUntil = 0;
    this.#processing = false;
    this.#committedHeard = '';
    this.#heardBuf = '';
    this.#openUserLineId = null;
    this.emitLog('info', `New utterance while thinking — ${incoming.slice(0, 80)}`);
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
  }

  #armCommit(): void {
    if (this.#commitTimer) clearTimeout(this.#commitTimer);
    if (!this.#heardBuf || this.#closed) return;
    this.#cancelSilenceWatch();
    const now = Date.now();
    const quietMs = now - this.#lastSttAt;
    const needMs = telephonyCommitDelayMs(this.#heardBuf, this.#commitTuning());
    const tuning = this.#commitTuning();
    const remaining = Math.min(needMs, tuning.commitCapMs) - quietMs;
    this.#commitTimer = setTimeout(() => this.#onCommitTimer(), Math.max(40, remaining));
  }

  #onCommitTimer(): void {
    this.#commitTimer = undefined;
    if (this.#closed || !this.#heardBuf) return;
    if (this.#processing) {
      this.#commitTimer = setTimeout(() => this.#onCommitTimer(), 80);
      return;
    }
    if (
      !shouldTelephonyCommitUserTurn({
        text: this.#heardBuf,
        now: Date.now(),
        lastSttAt: this.#lastSttAt,
        tuning: this.#commitTuning(),
      })
    ) {
      this.#armCommit();
      return;
    }
    this.#commitHeard();
  }

  #commitHeard(): void {
    const fullText = this.#heardBuf.trim();
    if (!fullText) return;
    const durationMs = this.#heardDurationMs || undefined;
    this.#heardBuf = '';
    this.#heardDurationMs = 0;
    if (this.#commitTimer) {
      clearTimeout(this.#commitTimer);
      this.#commitTimer = undefined;
    }

    const resolved = this.#resolveSegmentedUserCommit(fullText);
    if (!resolved) {
      this.emitLog('info', `Skip duplicate user commit: ${fullText.slice(0, 80)}`);
      return;
    }

    this.#committedHeard = resolved.transcriptText;
    this.emitLog('info', `Commit user turn: ${resolved.transcriptText.slice(0, 80)}`);
    this.#processing = true;
    void this.#onUserSpeech(resolved.llmText, durationMs, {
      transcriptText: resolved.transcriptText,
    });
  }

  /** Dedupe Sarvam/Google cumulative segments; send only new suffix when caller continues. */
  #resolveSegmentedUserCommit(fullText: string): { llmText: string; transcriptText: string } | null {
    if (!this.#usesSegmentedStt()) {
      return { llmText: fullText, transcriptText: fullText };
    }

    const normFull = normalizeHeard(fullText);
    const normLast = normalizeHeard(this.#lastSegmentCommitText);
    const msSinceLast = Date.now() - this.#lastSegmentCommitAt;
    const assistantReplied = this.#assistantRepliedSince(this.#lastSegmentCommitAt);

    if (normFull && normFull === normLast && msSinceLast < 6000) {
      return null;
    }

    // Same ask again (prefix / subset / high overlap) after we already answered — skip.
    if (
      this.#lastSegmentCommitText &&
      msSinceLast < 18_000 &&
      assistantReplied &&
      (isNearDuplicateUtterance(this.#lastSegmentCommitText, fullText) ||
        isSameUtteranceContinuation(this.#lastSegmentCommitText, fullText, {
          msSinceCommit: msSinceLast,
        }))
    ) {
      const suffix = this.#extractUtteranceSuffix(this.#lastSegmentCommitText, fullText);
      const suffixWords = suffix.split(/\s+/).filter((w) => w.length >= 3).length;
      // Only accept if caller clearly added a new ask (e.g. pricing after location).
      if (suffixWords < 4) {
        return null;
      }
      this.#lastSegmentCommitText = fullText;
      this.#lastSegmentCommitAt = Date.now();
      return { llmText: suffix, transcriptText: fullText };
    }

    if (normLast && msSinceLast < 12_000 && normFull.startsWith(normLast) && normFull.length > normLast.length) {
      const suffix = this.#extractUtteranceSuffix(this.#lastSegmentCommitText, fullText);
      const suffixWords = suffix.split(/\s+/).filter(Boolean).length;
      if (assistantReplied && suffixWords > 0 && suffixWords < 4) {
        return null;
      }
      if (suffixWords >= 2) {
        this.#lastSegmentCommitText = fullText;
        this.#lastSegmentCommitAt = Date.now();
        return { llmText: suffix, transcriptText: fullText };
      }
    }

    this.#lastSegmentCommitText = fullText;
    this.#lastSegmentCommitAt = Date.now();
    return { llmText: fullText, transcriptText: fullText };
  }

  #assistantRepliedSince(sinceMs: number): boolean {
    if (!sinceMs) return false;
    return this.#transcript.some(
      (line) => line.role === 'agent' && line.timestamp >= sinceMs && line.isFinal !== false,
    );
  }

  #extractUtteranceSuffix(prev: string, next: string): string {
    const prevWords = prev.trim().split(/\s+/).filter(Boolean);
    const nextWords = next.trim().split(/\s+/).filter(Boolean);
    if (nextWords.length <= prevWords.length) return '';
    let i = 0;
    while (
      i < prevWords.length &&
      i < nextWords.length &&
      normalizeHeard(prevWords[i]!) === normalizeHeard(nextWords[i]!)
    ) {
      i += 1;
    }
    if (i === 0) {
      const merged = mergeUserUtterance(prev, next);
      if (merged === next && next.length > prev.length) {
        return next.slice(prev.length).trim();
      }
      return next;
    }
    return nextWords.slice(i).join(' ');
  }

  #clearHeard(): void {
    if (this.#commitTimer) clearTimeout(this.#commitTimer);
    this.#commitTimer = undefined;
    this.#heardBuf = '';
    this.#heardDurationMs = 0;
    this.#committedHeard = '';
    this.#abortSpeculate();
  }

  #abortSpeculate(): void {
    if (this.#speculateTimer) clearTimeout(this.#speculateTimer);
    this.#speculateTimer = undefined;
    this.#speculateAbort?.abort();
    this.#speculateAbort = null;
    this.#speculatePromise = null;
    this.#speculatedHeard = '';
    this.#speculatedSentences = [];
    this.#speculatedReply = null;
    this.#speculateOnSentence = null;
  }

  #maybeSpeculate(): void {
    if (!this.#agent || this.#closed || this.#processing || this.#isAgentPlaying()) return;
    // Segment-VAD STT (Sarvam/Google) fires partial phrase finals — wait for full commit.
    if (this.#usesSegmentedStt()) return;
    if (!shouldSpeculateOnInterim(this.#heardBuf)) {
      if (this.#speculatedHeard && !speculativeHeardMatch(this.#speculatedHeard, this.#heardBuf)) {
        this.#abortSpeculate();
      }
      return;
    }
    if (
      this.#speculatedHeard &&
      speculativeHeardMatch(this.#speculatedHeard, this.#heardBuf) &&
      (this.#speculatePromise || this.#speculatedReply)
    ) {
      return;
    }
    this.#abortSpeculate();
    const heard = this.#heardBuf;
    this.#speculateTimer = setTimeout(() => {
      this.#speculateTimer = undefined;
      if (this.#heardBuf !== heard && !speculativeHeardMatch(heard, this.#heardBuf)) return;
      void this.#startSpeculate();
    }, this.#latency.speculativeStableMs);
  }

  async #startSpeculate(): Promise<void> {
    if (!this.#agent || this.#closed || this.#processing || !this.#heardBuf) return;
    if (!shouldSpeculateOnInterim(this.#heardBuf)) return;
    const abort = new AbortController();
    this.#speculateAbort = abort;
    this.#speculatedHeard = this.#heardBuf;
    this.#speculatedSentences = [];
    this.#speculatedReply = null;
    const heard = this.#speculatedHeard;
    this.emitLog('info', `Speculative LLM on: ${heard.slice(0, 80)}`);
    const promise = streamReply(
      this.#agent,
      this.#history,
      heard,
      {
        agentId: this.#agentId,
        callId: this.#callId,
        prospectName: this.#prospectName,
        contactPhone: this.#contactPhone,
        contactEmail: this.#contactEmail,
        agentGender: this.#agent.agentGender,
      },
      {
        signal: abort.signal,
        promptCacheKey: this.#callId,
        onSentence: (sentence) => {
          this.#speculatedSentences.push(sentence);
          this.#speculateOnSentence?.(sentence);
        },
      },
    );
    this.#speculatePromise = promise;
    try {
      const result = await promise;
      if (abort.signal.aborted || this.#speculateAbort !== abort) return;
      this.#speculatedReply = result;
    } catch {
      if (!abort.signal.aborted) this.#speculatedReply = null;
    } finally {
      if (this.#speculatePromise === promise) this.#speculatePromise = null;
    }
  }

  async #onUserSpeech(
    text: string,
    durationMs?: number,
    opts?: { transcriptText?: string },
  ): Promise<void> {
    const epoch = ++this.#turnEpoch;
    const stillThisReply = () => epoch === this.#turnEpoch && !this.#closed;

    try {
      if (this.#closed || !this.#agent) return;
      if (this.#isDeadLine()) {
        console.log('[telephony] Ignored STT on dead line:', text.slice(0, 60));
        this.emitLog('info', `Ignored STT on dead line: ${text.slice(0, 60)}`);
        return;
      }
      const raw = stripLeadingSttNumberNoise(text);
      const recent = this.#transcript.slice(-6).map((line) => line.text);
      const aliased = applySuvSttAliases(
        applyProductNameAliases(raw, this.#agent.productName),
        recent,
        this.#agent.productName,
      );
      text = aliased;
      if (STT_HALLUCINATION_RE.test(text) || this.#isPhantomTranscript(text) || this.#looksLikeEcho(text)) {
        this.emitLog('info', `Ignored STT noise/echo: ${text.slice(0, 60)}`);
        return;
      }

      this.#cancelSilenceWatch();
      const userFinalAt = Date.now();
      this.#lastUserFinalAt = userFinalAt;
      const sttMs = durationMs ?? (this.#listenStartedAt ? userFinalAt - this.#listenStartedAt : undefined);
      this.#listenStartedAt = 0;

      const lastAssistant =
        [...this.#history].reverse().find((m) => m.role === 'assistant')?.content ??
        this.#currentAgentText;
      const recentAssistantTexts = this.#history
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
        .filter(Boolean);
      const skills = mergeSkillsConfig(this.#agent.skillsConfig);
      const prepared = await prepareSimulator2UserTurn({
        heard: text,
        lastAssistantText: lastAssistant,
        recentAssistantTexts,
        productName: this.#agent.productName,
        skills,
        knownEmailDomains: getKnownEmailDomains(skills),
        state: this.#turnState,
        direction: this.#callDirection,
        openerDelivered: this.#outboundOpenerDelivered,
        productKnowledge: productKnowledgeFromSources(
          this.#agent.brainSummary,
          this.#agent.compiledSystemPrompt,
        ),
        hasConsumedLeadHistory: Boolean(this.#agent.hasConsumedLeadHistory),
        agentGender: this.#agent.agentGender,
        contactName: this.#prospectName,
      });
      if (!stillThisReply()) return;
      this.#turnState = prepared.state;
      if (prepared.ttsLocale) this.#ttsLanguage = prepared.ttsLocale;

      if (prepared.kind === 'mute') {
        this.#abortSpeculate();
        this.#quietMs = 0;
        this.#quietGraceUntil = Date.now() + QUIET_GRACE_AFTER_SELF_CUT_MS;
        if (this.#interrupted) {
          this.#turnState = { ...this.#turnState, callerInterrupted: false };
        }
        const muteLine = `Turn muted (${prepared.reason}): ${text.slice(0, 80)}`;
        console.log('[telephony]', muteLine);
        this.emitLog('info', muteLine);
        emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
        this.#listenStartedAt = Date.now();
        this.#committedHeard = '';
        this.#scheduleSilenceWatch();
        this.#openUserLineId = null;
        return;
      }

      this.#publishUserTranscript(opts?.transcriptText?.trim() || text);
      if (sttMs) this.#metrics.addSttAudioMs(sttMs);
      emitTelephonyEvent(this.#callId, { type: 'usage', ...this.#metrics.usageSnapshot() });
      const llmText =
        prepared.kind === 'reply' ? prepared.userContent : prepared.kind === 'say' ? prepared.text : text;
      this.emitLog(
        'info',
        `Prospect raw="${raw.slice(0, 80)}" aliased="${aliased.slice(0, 80)}" llm="${llmText.slice(0, 80)}"`,
      );

      if (prepared.kind === 'say') {
        this.#abortSpeculate();
        emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });
        const spoken = await this.#runSpokenTurn(
          async () => ({
            text: lockSpokenHinglishGender(prepared.text, this.#agent.agentGender),
            usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 },
          }),
          { scripted: true },
        );
        if (!stillThisReply()) return;
        if (spoken?.text) {
          this.#history.push({ role: 'user', content: opts?.transcriptText?.trim() || text });
          this.#history.push({ role: 'assistant', content: spoken.text });
          this.#turnState = rememberSimulator2Assistant(this.#turnState, spoken.text);
        }
        if (prepared.then === 'hangup' && !this.#closed) {
          await this.requestHangup(prepared.hangupReason ?? 'wrap_limit');
        }
        return;
      }

      emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });
      const canUseSpec =
        Boolean(this.#speculatedHeard) &&
        speculativeHeardMatch(this.#speculatedHeard, text) &&
        !prepared.userContent.includes('[SYSTEM:');

      const reply = await this.#runSpokenTurn(
        (hooks) => {
          if (canUseSpec && (this.#speculatePromise || this.#speculatedReply)) {
            this.emitLog(
              'info',
              `Reuse speculative LLM, skip second call (${this.#speculatedHeard.slice(0, 60)})`,
            );
            this.#turnAbort?.signal.addEventListener('abort', () => this.#speculateAbort?.abort());
            this.#speculateOnSentence = hooks.onSentence;
            for (const sentence of this.#speculatedSentences) hooks.onSentence(sentence);
            if (this.#speculatedReply) {
              this.#speculateOnSentence = null;
              return Promise.resolve(this.#speculatedReply);
            }
            if (this.#speculatePromise) {
              return this.#speculatePromise.then((result) => {
                this.#speculateOnSentence = null;
                return result;
              });
            }
          }
          this.#abortSpeculate();
          return streamReply(this.#agent!, this.#history, prepared.userContent, {
            agentId: this.#agentId,
            callId: this.#callId,
            prospectName: this.#prospectName,
            contactPhone: this.#contactPhone,
            contactEmail: this.#contactEmail,
            agentGender: this.#agent?.agentGender,
          }, {
            signal: hooks.signal,
            onSentence: hooks.onSentence,
            onToolHold: hooks.onToolHold,
            promptCacheKey: this.#callId,
          });
        },
        { sttMs },
      );
      if (!stillThisReply()) return;
      this.#history.push({ role: 'user', content: opts?.transcriptText?.trim() || text });
      if (reply?.bookingSaved) {
        this.#turnState = markBookingSaved(
          this.#turnState,
          this.#turnState.callFacts.facts.preferred_time,
        );
      }
      if (reply?.text) {
        this.#history.push({ role: 'assistant', content: reply.text });
        this.#turnState = rememberSimulator2Assistant(this.#turnState, reply.text);
      }
      if (!this.#closed && reply?.hangup) {
        await this.requestHangup('end_call');
      } else if (!this.#closed && isPoliteEndCue(text)) {
        await this.requestHangup('caller_goodbye');
      }
    } catch (err) {
      if (!stillThisReply()) return;
      const message = err instanceof Error ? err.message : 'Reply failed';
      console.error('[telephony] reply failed', err);
      this.emitLog('error', message);
      emitTelephonyEvent(this.#callId, { type: 'error', message });
    } finally {
      if (epoch !== this.#turnEpoch) return;
      this.#processing = false;
      this.#committedHeard = '';
      this.#openUserLineId = null;
      this.#speculateOnSentence = null;
      if (this.#pendingUserText) {
        this.#heardBuf = mergeUserUtterance(this.#heardBuf, this.#pendingUserText);
        this.#pendingUserText = null;
      }
      if (this.#heardBuf && !this.#closed) this.#armCommit();
    }
  }

  async #runSpokenTurn(
    produce: (hooks: {
      onSentence: (sentence: string) => void;
      signal: AbortSignal;
      onToolHold: (toolName: string) => Promise<void>;
    }) => Promise<LlmTextResult>,
    opts?: { sttMs?: number; scripted?: boolean; opener?: boolean },
  ): Promise<LlmTextResult | null> {
    if (!this.#agent || this.#closed) return null;
    const gen = ++this.#speakGen;
    this.#interrupted = false;
    this.#speaking = false;
    this.#playbackUntil = 0;
    this.#sentAudioMs = 0;
    this.#audioStartedAt = 0;
    this.#bargeEnergyMs = 0;
    this.#bargeMisses = 0;
    this.#bargeEchoFloor = 0;
    this.#duplexSttActive = false;
    this.#clearBargeAudio();
    this.#turnAbort = new AbortController();
    if (!opts?.scripted) this.#cancelSilenceWatch();
    const ownsProcessing = !this.#processing;
    if (ownsProcessing) this.#processing = true;
    const turnStarted = Date.now();
    const queue: SpeakChunk[] = [];
    const spokenChunks: string[] = [];
    let pumping = false;
    let firstAudioAt = 0;
    let ttsTtfbMs = 0;
    let ttsStarted = 0;
    let realEnqueued = 0;

    const stillThisTurn = () => this.#speakGen === gen && !this.#closed;

    const enqueue = (chunk: SpeakChunk) => {
      const text = chunk.text.trim();
      if (!text || !isSpeakableTts(text) || !stillThisTurn() || this.#interrupted) return;
      if (!chunk.filler) realEnqueued += 1;
      queue.push({ text, filler: chunk.filler });
      void pump();
    };

    const pump = async () => {
      if (pumping) return;
      pumping = true;
      try {
        while (queue.length && stillThisTurn() && !this.#interrupted) {
          const first = queue.shift()!;
          if (first.filler) {
            if (!isSpeakableTts(first.text)) continue;
            spokenChunks.push(first.text);
            this.#currentAgentText = spokenChunks.join(' ');
            this.#appendTranscript('agent', first.text);
            this.#metrics.addTtsChars(first.text.length);
            if (!ttsStarted) ttsStarted = Date.now();
            await this.#speakMulawChunk(first.text, gen, (at) => {
              if (firstAudioAt) return;
              firstAudioAt = at;
              ttsTtfbMs = at - ttsStarted;
            });
            continue;
          }

          const combined = first.text.trim();
          if (!isSpeakableTts(combined)) continue;

          spokenChunks.push(first.text);
          this.#appendTranscript('agent', first.text);
          this.#metrics.addTtsChars(first.text.length);
          this.#currentAgentText = spokenChunks.join(' ');
          if (!ttsStarted) ttsStarted = Date.now();
          await this.#speakMulawChunk(combined, gen, (at) => {
            if (firstAudioAt) return;
            firstAudioAt = at;
            ttsTtfbMs = at - ttsStarted;
            const felt = this.#lastUserFinalAt
              ? firstAudioAt - this.#lastUserFinalAt
              : firstAudioAt - turnStarted;
            this.emitLog(
              'info',
              `TTS first frame felt=${felt}ms ttsTtfb=${ttsTtfbMs}ms`,
            );
            if (opts?.opener && this.#connectedAt) {
              this.emitLog(
                'info',
                `pickup_to_first_audio_ms=${firstAudioAt - this.#connectedAt}`,
              );
            }
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'TTS pump failed';
        console.error('[telephony] TTS pump failed', err);
        this.emitLog('error', message);
      } finally {
        pumping = false;
        if (queue.length && stillThisTurn() && !this.#interrupted) void pump();
      }
    };

    const drainSpeakQueue = async () => {
      while ((pumping || queue.length) && stillThisTurn() && !this.#interrupted) {
        await sleep(20);
      }
    };

    const onToolHold = async (toolName: string) => {
      if (!isToolHoldEnabled() || !this.#agent) return;
      const line = resolveToolHoldLine(toolName, {
        agentGender: this.#agent.agentGender,
        skills: this.#agent.skillsConfig,
      });
      if (!line || !stillThisTurn() || this.#interrupted) return;
      this.emitLog('info', `Tool hold: ${line}`);
      await drainSpeakQueue();
      if (!stillThisTurn() || this.#interrupted) return;
      enqueue({ text: line, filler: true });
      await drainSpeakQueue();
      if (stillThisTurn() && !this.#interrupted) await this.#waitForPlayback(gen);
    };

    try {
      let reply: LlmTextResult;
      try {
        reply = await produce({
          onSentence: (sentence) => enqueue({ text: sentence, filler: false }),
          signal: this.#turnAbort.signal,
          onToolHold,
        });
      } catch (err) {
        if (this.#turnAbort.signal.aborted || this.#interrupted) {
          reply = {
            text: spokenChunks.join(' ').trim(),
            usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 },
          };
        } else {
          throw err;
        }
      }
      this.#metrics.addLlmUsage(
        reply.usage.promptTokens,
        reply.usage.completionTokens,
        reply.usage.cachedPromptTokens,
      );
      if (!opts?.scripted && reply.usage.promptTokens) {
        this.emitLog(
          'info',
          `LLM tokens in=${reply.usage.promptTokens} cached=${reply.usage.cachedPromptTokens ?? 0} out=${reply.usage.completionTokens}`,
        );
      }
      emitTelephonyEvent(this.#callId, { type: 'usage', ...this.#metrics.usageSnapshot() });
      if (this.#closed) return reply;
      if (!stillThisTurn() || this.#interrupted) {
        this.emitLog('info', 'Skip remaining TTS — caller already speaking');
        return reply;
      }

      if (!realEnqueued && reply.text.trim()) {
        enqueue({ text: reply.text, filler: false });
      }
      this.#metrics.addAgentTurn();
      emitTelephonyEvent(this.#callId, { type: 'usage', ...this.#metrics.usageSnapshot() });
      const spoken = spokenChunks.join(' ').trim() || reply.text;
      this.emitLog('info', `Agent: ${spoken.slice(0, 120)}`);

      while ((pumping || queue.length) && stillThisTurn() && !this.#interrupted) {
        await sleep(20);
      }

      if (stillThisTurn() && !this.#interrupted && firstAudioAt) {
        this.#send({
          event: 'mark',
          streamSid: this.#streamSid,
          mark: { name: `utt-${Date.now()}` },
        });
        const feltResponseMs = this.#lastUserFinalAt
          ? firstAudioAt - this.#lastUserFinalAt
          : firstAudioAt - turnStarted;
        const turn = this.#metrics.recordTurn({
          feltResponseMs,
          responseLatencyMs: feltResponseMs,
          llmTtftMs: reply.usage.ttftMs,
          ttsTtfbMs,
          e2eMs: feltResponseMs,
          sttMs: opts?.sttMs,
        });
        emitTelephonyEvent(this.#callId, { type: 'turn_metrics', ...turn });
        this.emitLog(
          'info',
          `felt=${feltResponseMs}ms llmTtft=${reply.usage.ttftMs}ms ttsTtfb=${ttsTtfbMs}ms`,
        );
        await this.#waitForPlayback(gen);
      }
      return { ...reply, text: spoken || reply.text };
    } finally {
      if (this.#speakGen === gen) {
        this.#speaking = false;
        this.#currentAgentText = '';
        this.#playbackUntil = 0;
        this.#echoMuteUntil = Date.now() + ECHO_TAIL_MS;
        if (!this.#closed) {
          emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
          this.#listenStartedAt = Date.now();
          if (!opts?.scripted && !this.#pendingUserText && !this.#heardBuf) this.#scheduleSilenceWatch();
        }
      }
      if (ownsProcessing) {
        this.#processing = false;
        if (this.#pendingUserText) {
          this.#heardBuf = mergeUserUtterance(this.#heardBuf, this.#pendingUserText);
          this.#pendingUserText = null;
        }
        if (this.#heardBuf && !this.#closed) this.#armCommit();
      }
    }
  }

  async #playScriptedOutboundOpener(): Promise<LlmTextResult | null> {
    if (!this.#agent || this.#closed) return null;
    const text = resolveScriptedOpener(this.#agent, this.#prospectName);
    if (!isSpeakableTts(text)) return null;

    const gen = ++this.#speakGen;
    this.#interrupted = false;
    this.#speaking = false;
    this.#playbackUntil = 0;
    this.#sentAudioMs = 0;
    this.#audioStartedAt = 0;
    this.#clearBargeAudio();
    this.#processing = true;
    const turnStarted = Date.now();
    let firstAudioAt = 0;

    try {
      this.#appendTranscript('agent', text);
      this.#currentAgentText = text;
      this.#metrics.addTtsChars(text.length);
      this.#metrics.addAgentTurn();

      const warmed = await awaitWarmedOpenerFrames(this.#callId, 300);
      const onFirstFrame = (at: number) => {
        if (firstAudioAt) return;
        firstAudioAt = at;
        this.emitLog('info', `TTS first frame felt=${at - turnStarted}ms ttsTtfb=${at - turnStarted}ms`);
        if (this.#connectedAt) {
          this.emitLog('info', `pickup_to_first_audio_ms=${at - this.#connectedAt}`);
        }
      };

      if (warmed?.length) {
        this.emitLog(
          'info',
          `Playing pre-warmed opener (${warmed.length} frames)`,
          undefined,
          'pipeline',
        );
        await this.#playMulawFrames(warmed, gen, onFirstFrame);
      } else {
        await this.#speakMulawChunk(text, gen, onFirstFrame);
      }

      if (this.#speakGen === gen && !this.#interrupted && firstAudioAt) {
        await this.#waitForPlayback(gen);
      }
      this.emitLog('info', `Agent: ${text.slice(0, 120)}`);
      return { text, usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 } };
    } finally {
      if (this.#speakGen === gen) {
        this.#speaking = false;
        this.#currentAgentText = '';
        this.#playbackUntil = 0;
        this.#echoMuteUntil = Date.now() + ECHO_TAIL_MS;
        if (!this.#closed) {
          emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
          this.#listenStartedAt = Date.now();
        }
      }
      this.#processing = false;
    }
  }

  async #playMulawFrames(
    frames: Buffer[],
    gen: number,
    onFirstFrame?: (at: number) => void,
  ): Promise<void> {
    for (const frame of frames) {
      if (this.#closed || this.#speakGen !== gen) return;
      const now = Date.now();
      if (!this.#audioStartedAt) {
        this.#speaking = true;
        this.#speakStartedAt = now;
        this.#audioStartedAt = now;
        this.#sentAudioMs = 0;
        emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'speaking' });
      }
      onFirstFrame?.(now);
      onFirstFrame = undefined;
      this.#mediaChunk += 1;
      this.#send({
        event: 'media',
        streamSid: this.#streamSid,
        media: {
          payload: frame.toString('base64'),
          chunk: String(this.#mediaChunk),
        },
      });
      this.#sentAudioMs += 100;
      this.#playbackUntil = this.#audioStartedAt + this.#sentAudioMs;
      const ahead = this.#playbackUntil - Date.now();
      const lookahead = this.#commitTuning().ttsLookaheadMs;
      if (ahead > lookahead) {
        await this.#sleepUnlessStale(ahead - lookahead, gen);
      }
    }
  }

  async #speakMulawChunk(
    text: string,
    gen: number,
    onFirstFrame?: (at: number) => void,
  ): Promise<void> {
    if (!this.#agent || this.#closed || this.#speakGen !== gen || !isSpeakableTts(text)) return;
    let chunkFirstFrame = true;
    const result = await streamMulaw8kFrames(
      {
        text,
        voiceId: this.#agent.voiceId,
        voiceLanguages: this.#agent.voiceLanguages,
        speed: this.#agent.voiceSpeed,
        pitch: this.#agent.voicePitch,
        modelId: this.#agent.ttsModel,
        sampleRate: 8000,
        emotion: resolveSimulator2TtsEmotion(this.#agent.ttsEmotion),
        language: this.#ttsLanguage ?? undefined,
        agentGender: this.#agent.agentGender,
      },
      async (frame) => {
        if (this.#closed || this.#speakGen !== gen) return false;
        const now = Date.now();
        if (chunkFirstFrame) {
          chunkFirstFrame = false;
          this.#speakStartedAt = now;
          this.#bargeEnergyMs = 0;
          this.#bargeMisses = 0;
        }
        if (!this.#audioStartedAt) {
          this.#speaking = true;
          this.#audioStartedAt = now;
          this.#sentAudioMs = 0;
          emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'speaking' });
        }
        onFirstFrame?.(now);
        onFirstFrame = undefined;
        this.#mediaChunk += 1;
        this.#send({
          event: 'media',
          streamSid: this.#streamSid,
          media: {
            payload: frame.toString('base64'),
            chunk: String(this.#mediaChunk),
          },
        });
        this.#sentAudioMs += 100;
        this.#playbackUntil = this.#audioStartedAt + this.#sentAudioMs;
        const ahead = this.#playbackUntil - Date.now();
        const lookahead = this.#commitTuning().ttsLookaheadMs;
        if (ahead > lookahead) {
          await this.#sleepUnlessStale(ahead - lookahead, gen);
        }
        return this.#speakGen === gen && !this.#closed;
      },
    );
    if (result.frames) {
      this.emitLog('info', `TTS streamed ${result.frames} x 100ms frames`);
    }
  }

  async #sleepUnlessStale(ms: number, gen: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end && !this.#closed && this.#speakGen === gen) {
      await sleep(Math.min(50, end - Date.now()));
    }
  }

  async #waitForPlayback(gen: number): Promise<void> {
    while (!this.#closed && this.#speakGen === gen && Date.now() < this.#playbackUntil) {
      await sleep(50);
    }
  }

  #silenceLines(): { checkIn: string; goodbye: string } {
    const silence = this.#agent?.skillsConfig?.core?.silence;
    return {
      checkIn: silence?.checkInLine?.trim() || 'Hello, kya meri awaaz aa rehi hai?',
      goodbye: silence?.goodbyeLine?.trim() || 'Lagta hai line quiet hai — main disconnect kar rehi hoon. Dhanyavaad.',
    };
  }

  #cancelSilenceWatch(): void {
    if (this.#silenceCheckTimer) clearTimeout(this.#silenceCheckTimer);
    if (this.#silenceGoodbyeTimer) clearTimeout(this.#silenceGoodbyeTimer);
    this.#silenceCheckTimer = undefined;
    this.#silenceGoodbyeTimer = undefined;
  }

  #nudgeSilenceCheckIn(): void {
    this.#nudgeSilenceWatch();
  }

  #nudgeSilenceWatch(): void {
    if (this.#useRealtimeS2s) return;
    if (this.#closed || this.#processing || this.#heardBuf || this.#isAgentPlaying()) return;
    if (!this.#silenceCheckTimer && !this.#silenceGoodbyeTimer && !this.#checkInDone) return;
    const now = Date.now();
    if (now - this.#lastSilenceNudgeAt < 400) return;
    this.#lastSilenceNudgeAt = now;

    if (this.#silenceGoodbyeTimer) {
      clearTimeout(this.#silenceGoodbyeTimer);
      this.#silenceGoodbyeTimer = setTimeout(() => {
        void this.#onSilenceGoodbye();
      }, SILENCE_GOODBYE_MS);
    }

    // Energy / no-match must not re-arm the 3s "please repeat" nag after we already asked.
    if (this.#checkInDone) return;
    if (this.#silenceCheckTimer) clearTimeout(this.#silenceCheckTimer);
    this.#silenceCheckTimer = setTimeout(() => {
      void this.#onSilenceCheckIn();
    }, SILENCE_CHECK_IN_MS);
  }

  #scheduleSilenceWatch(): void {
    if (this.#useRealtimeS2s) return;
    this.#cancelSilenceWatch();
    if (this.#closed) return;
    this.#checkInDone = false;
    this.#listenHadEnergy = false;
    this.#silenceCheckTimer = setTimeout(() => {
      void this.#onSilenceCheckIn();
    }, SILENCE_CHECK_IN_MS);
    this.#silenceGoodbyeTimer = setTimeout(() => {
      void this.#onSilenceGoodbye();
    }, SILENCE_GOODBYE_MS);
  }

  async #onSilenceCheckIn(): Promise<void> {
    this.#silenceCheckTimer = undefined;
    if (this.#useRealtimeS2s) return;
    if (this.#closed || this.#processing || this.#pendingUserText || this.#heardBuf || this.#isAgentPlaying()) return;
    this.#checkInDone = true;
    const recentlyVoiced = this.#lastVoicedAt > 0 && Date.now() - this.#lastVoicedAt < 4_000;
    if (this.#listenHadEnergy && recentlyVoiced) {
      this.emitLog('info', 'Silence check-in skipped — inbound energy, waiting for STT');
      return;
    }
    const text = this.#silenceLines().checkIn;
    this.emitLog('info', 'Silence check-in (quiet)');
    await this.#runSpokenTurn(
      async () => ({ text, usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 } }),
      { scripted: true },
    );
  }

  async #onSilenceGoodbye(): Promise<void> {
    this.#silenceGoodbyeTimer = undefined;
    if (this.#useRealtimeS2s) return;
    if (this.#closed) return;
    if (this.#processing || this.#pendingUserText || this.#heardBuf || this.#isAgentPlaying()) {
      if (this.#lastInboundAt && Date.now() - this.#lastInboundAt >= DEAD_MEDIA_MS) {
        this.emitLog('info', 'Silence goodbye — media already gone, ending call');
        await this.requestHangup('silence_media_gone');
        return;
      }
      this.#silenceGoodbyeTimer = setTimeout(() => {
        void this.#onSilenceGoodbye();
      }, 500);
      return;
    }
    this.#cancelSilenceWatch();
    const recentlyVoiced = this.#lastVoicedAt > 0 && Date.now() - this.#lastVoicedAt < 4_000;
    if (this.#listenHadEnergy && recentlyVoiced) {
      this.emitLog('info', 'Silence hangup skipped — caller audio detected');
      this.#scheduleSilenceWatch();
      return;
    }
    const text = this.#silenceLines().goodbye;
    this.emitLog('info', 'Silence goodbye — ending call');
    await this.#runSpokenTurn(
      async () => ({ text, usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 } }),
      { scripted: true },
    );
    if (!this.#closed) await this.requestHangup('silence');
  }

  #appendTranscript(role: 'user' | 'agent', text: string): void {
    this.#emitTranscriptLine(role, text, true);
  }

  #emitTranscriptLine(role: 'user' | 'agent', text: string, final: boolean): void {
    let trimmed = text.trim();
    if (!trimmed) return;

    if (role === 'user' && this.#committedUserTranscript) {
      const committed = this.#committedUserTranscript.trim();
      if (trimmed === committed || committed.startsWith(trimmed)) return;
      if (trimmed.startsWith(committed)) {
        trimmed = trimmed.slice(committed.length).trim();
        if (!trimmed) return;
      }
    }

    const openId = role === 'user' ? this.#openUserLineId : this.#openAgentLineId;
    if (openId) {
      const idx = this.#transcript.findIndex((line) => line.id === openId);
      if (idx >= 0 && this.#transcript[idx]?.role === role) {
        const prev = this.#transcript[idx]!.text.trim();
        // Prefer cumulative growth; append delta fragments; never shrink to a tail crumb.
        let merged = trimmed;
        if (prev) {
          if (trimmed.startsWith(prev) || trimmed.includes(prev)) merged = trimmed;
          else if (prev.startsWith(trimmed) || prev.includes(trimmed)) merged = prev;
          else {
            const gap = /[\s\u00a0]$/.test(prev) || /^[\s\u00a0]/.test(trimmed) ? '' : ' ';
            merged = `${prev}${gap}${trimmed}`;
          }
        }
        const line: TranscriptLine = {
          ...this.#transcript[idx]!,
          text: merged,
          isFinal: final,
          timestamp: Date.now(),
        };
        this.#transcript[idx] = line;
        emitTelephonyEvent(this.#callId, { type: 'transcript', line });
        if (final) {
          if (role === 'user') {
            this.#openUserLineId = null;
            this.#committedUserTranscript = `${this.#committedUserTranscript} ${merged}`.trim();
          } else this.#openAgentLineId = null;
        }
        return;
      }
    }

    const line: TranscriptLine = {
      id: `${role}-${this.#transcript.length + 1}`,
      role,
      text: trimmed,
      isFinal: final,
      timestamp: Date.now(),
    };
    this.#transcript.push(line);
    emitTelephonyEvent(this.#callId, { type: 'transcript', line });
    if (role === 'user') {
      this.#openUserLineId = final ? null : line.id;
      if (final) this.#committedUserTranscript = `${this.#committedUserTranscript} ${trimmed}`.trim();
    } else this.#openAgentLineId = final ? null : line.id;
  }

  #finalizeOpenUserTranscript(): void {
    if (!this.#openUserLineId) return;
    const idx = this.#transcript.findIndex((line) => line.id === this.#openUserLineId);
    if (idx < 0 || !this.#transcript[idx]) {
      this.#openUserLineId = null;
      return;
    }
    const prev = this.#transcript[idx]!;
    if (prev.isFinal) {
      this.#openUserLineId = null;
      return;
    }
    const text = prev.text.trim();
    if (!text) {
      this.#openUserLineId = null;
      return;
    }
    const line: TranscriptLine = { ...prev, isFinal: true, timestamp: Date.now() };
    this.#transcript[idx] = line;
    this.#openUserLineId = null;
    this.#committedUserTranscript = `${this.#committedUserTranscript} ${text}`.trim();
    emitTelephonyEvent(this.#callId, { type: 'transcript', line });
    this.#metrics.addUserTurn();
  }

  /** Fold updates the open user row so the UI does not snowball prefix copies. */
  #publishUserTranscript(text: string, final = true): void {
    const committedBefore = this.#committedUserTranscript;
    this.#emitTranscriptLine('user', text, final);
    if (final && this.#committedUserTranscript !== committedBefore) {
      this.#metrics.addUserTurn();
    }
  }

  #publishAgentTranscript(text: string, final = true): void {
    this.#emitTranscriptLine('agent', text, final);
    if (final) {
      this.#metrics.addAgentTurn();
      const last = [...this.#transcript].reverse().find((l) => l.role === 'agent');
      this.#history.push({ role: 'assistant', content: (last?.text ?? text).trim() });
    }
  }

  async #startRealtimePipeline(
    s2sConfig: Partial<RealtimeS2sUserConfig> | undefined,
    direction: CallDirection,
    pipeline: 'openai_realtime' | 'gemini_live',
  ): Promise<void> {
    const agent = this.#agent!;
    const config = normalizeRealtimeS2sUserConfig(s2sConfig ?? {}, pipeline);
    if (pipeline === 'gemini_live') {
      const beforeModel = config.model;
      config.model = preferGeminiLiveModelForTelephony(resolveGeminiLiveModel(config.model));
      if (beforeModel !== config.model) {
        console.log(
          '[telephony]',
          `Gemini Live phone model ${beforeModel} → ${config.model} (GEMINI_LIVE_FORCE_25_ON_PHONE=1)`,
        );
      }
      // 3.x re-scores the full prompt every turn — keep VAD+prompt tight.
      // IMPORTANT: agent UI can save silenceMs=0; Math.min alone would keep 0 and
      // Gemini never ends the user turn promptly (feels like multi-second lag).
      const is31 = isGemini31LiveModel(config.model);
      config.turnDetectionPrefixPaddingMs = Math.min(
        Math.max(config.turnDetectionPrefixPaddingMs || 60, 40),
        is31 ? 80 : 60,
      );
      config.turnDetectionSilenceDurationMs = Math.min(
        Math.max(config.turnDetectionSilenceDurationMs || 110, 100),
        is31 ? 130 : 110,
      );
    }
    const supplement =
      pipeline === 'gemini_live'
        ? buildGeminiLiveS2sInstructionSupplement(config.voice, config.model).replace(
            /\(Simulator only\)/gi,
            '(Phone call)',
          )
        : buildRealtimeS2sInstructionSupplement(config.voice).replace(
            /\(Simulator only\)/gi,
            '(Phone call)',
          );
    const callTimeBlock = buildCallTimeContextPrompt();
    const geminiPromptCap = isGemini31LiveModel(config.model) ? 3200 : 3000;
    const body = appendHinglishGenderLock(
      `${refreshLanguagePrompt(agent.compiledSystemPrompt, agent.voiceLanguages)}${supplement}`,
      agent.agentGender,
      Math.max(1800, (pipeline === 'gemini_live' ? geminiPromptCap : 9000) - callTimeBlock.length - 20),
    );
    // Keep Call time at the front so prompt trim never drops the live greeting.
    const instructions = `${callTimeBlock}\n\n${body}`;
    if (body.length < agent.compiledSystemPrompt.length + supplement.length) {
      this.emitLog(
        'info',
        `Phone S2S prompt trimmed ${agent.compiledSystemPrompt.length + supplement.length}→${body.length} chars for latency`,
        undefined,
        'realtime',
      );
    }
    console.log(
      '[telephony]',
      `Starting ${pipeline} model=${config.model} voice=${config.voice} silenceMs=${config.turnDetectionSilenceDurationMs}`,
    );

    const callbacks = {
      onAudioMulaw: (frame: Buffer) => this.#playRealtimeMulawFrame(frame),
      onUserTranscript: (text: string, final: boolean) => {
        if (!text.trim()) return;
        this.#publishUserTranscript(text.trim(), final);
        if (final) {
          emitTelephonyEvent(this.#callId, { type: 'usage', ...this.#metrics.usageSnapshot() });
        }
      },
      onAgentTranscript: (text: string, final: boolean) => {
        if (!text.trim()) return;
        this.#publishAgentTranscript(text.trim(), final);
        if (final) {
          emitTelephonyEvent(this.#callId, { type: 'usage', ...this.#metrics.usageSnapshot() });
        }
      },
      onSpeechStarted: () => {
        // New caller utterance — seal any open Prospect row first.
        this.#finalizeOpenUserTranscript();
        if (this.#outboundOpenerArming || this.#realtimeAwaitingOpener) return;
        // Provider VAD on PSTN is mostly echo — never cut Acefone from it.
        // Local-energy path in #onMediaRealtime owns barge-in.
      },
      onInterrupted: (): 'ignore' | void => {
        // Half-duplex + NO_INTERRUPTION: Gemini still emits spurious `interrupted`
        // from residual audio / turn edges. Clearing Acefone here is what made
        // callers hear silence. Local-energy barge is the only cut path.
        this.emitLog('info', 'Ignored provider interrupt (local barge only)', undefined, 'realtime');
        return 'ignore';
      },
      onResponseStarted: () => {
        // Seal Prospect row when agent starts talking (ACTIVITY_END often missing on phone).
        this.#finalizeOpenUserTranscript();
        // Keep openAgentLineId — Gemini often streams outputTranscription before
        // the first audio chunk; clearing here would shatter one turn into many rows.
        this.#realtimePlaybackOpen = true;
        this.#realtimeBargeEnergyMs = 0;
        this.#s2sEarlyListenMs = 0;
        // Seed EMA baseline — never zero (echo would look like a barge spike).
        this.#s2sEchoBaseline = Math.max(S2S_ECHO_FLOOR_SEED, this.#s2sEchoBaseline * 0.5);
        this.#s2sEchoBaselineFrozen = 0;
        this.#s2sEchoPeak = 0;
        this.#bargeEchoFloor = this.#s2sEchoBaseline;
        if (!this.#closed) {
          this.#speaking = true;
          this.#audioStartedAt = Date.now();
          this.#sentAudioMs = 0;
          emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'speaking' });
        }
      },
      onSpeechStopped: () => {
        if (!this.#closed) {
          emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });
        }
      },
      onResponseDone: () => {
        if (this.#closed) return;
        this.#speaking = false;
        // Tiny tail only — long playbackUntil was delaying the next user turn to Gemini.
        this.#playbackUntil = Math.max(this.#playbackUntil, Date.now() + 50);
        this.#realtimePlaybackOpen = false;
        this.#realtimeBargeEnergyMs = 0;
        this.#s2sEarlyListenMs = 0;
        // If the caller spoke over the agent but barge never quite fired, still
        // deliver the buffered utterance so they are not forced to repeat.
        if (this.#s2sListenHadSpeech && this.#s2sListenBuf.length > 0) {
          this.emitLog(
            'info',
            `S2S flushing ${Math.round(this.#s2sListenBufMs)}ms buffered caller audio on responseDone`,
            undefined,
            'realtime',
          );
          this.#flushS2sListenBuf();
        }
        if (this.#realtimeAwaitingOpener) {
          // Only retry if almost no opener audio went out (not mid-sentence cuts).
          const thinOpener = this.#sentAudioMs < 200;
          this.#realtimeAwaitingOpener = false;
          this.#realtime?.enableAutoResponses();
          if (thinOpener && !this.#realtimeOpenerRetried && this.#agent) {
            this.#realtimeOpenerRetried = true;
            const agent = this.#agent;
            const prospect = this.#prospectName;
            setTimeout(() => {
              if (this.#closed) return;
              this.emitLog('info', 'Retrying outbound S2S opener after empty audio', undefined, 'realtime');
              this.#realtime?.createResponse(buildOutboundOpenerInstructions(agent, prospect));
            }, 250);
          }
        }
        emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
        this.#listenStartedAt = Date.now();
        this.#flushPendingRealtimeHangup();
      },
      onHangupRequested: (reason: string) => {
        this.#scheduleRealtimeHangup(reason);
      },
      onError: (message: string) => {
        this.emitLog('error', message, undefined, 'realtime');
        emitTelephonyEvent(this.#callId, { type: 'error', message });
      },
      onUsage: (usage: {
        inputTextTokens: number;
        inputAudioTokens: number;
        outputTextTokens: number;
        outputAudioTokens: number;
        totalTokens: number;
      }) => {
        emitTelephonyEvent(this.#callId, {
          type: 'usage',
          ...this.#metrics.addS2sUsage(usage),
        });
      },
      onLog: (message: string, detail?: unknown) =>
        this.emitLog('info', message, detail, 'realtime'),
    };

    if (pipeline === 'gemini_live') {
      this.#realtime = new TelephonyGeminiLiveClient({
        config,
        instructions,
        autoRespond: direction !== 'outbound',
        toolContext: {
          agentId: agent.id,
          callId: this.#callId,
          prospectName: this.#prospectName,
          contactPhone: this.#contactPhone,
          contactEmail: this.#contactEmail,
          bookingPolicy: mergeSkillsConfig(agent.skillsConfig).booking,
          agentGender: agent.agentGender,
        },
        callbacks,
      });
    } else {
      this.#realtime = new TelephonyRealtimeClient({
        config,
        instructions,
        autoRespond: direction !== 'outbound',
        callbacks,
      });
    }

    await this.#realtime.connect();
    this.emitLog(
      'info',
      pipeline === 'gemini_live'
        ? `Gemini Live S2S on phone: model=${config.model} voice=${config.voice} lang=${config.languageCode}`
        : `OpenAI Realtime S2S on phone: model=${config.model} voice=${config.voice}`,
      undefined,
      'realtime',
    );

    if (direction === 'outbound') {
      await sleep(100);
      emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });
      this.#realtimeAwaitingOpener = true;
      this.#realtimeOpenerRetried = false;
      this.#outboundOpenerArming = true;
      this.#realtime.createResponse(
        buildOutboundOpenerInstructions(agent, this.#prospectName),
      );
      this.#outboundOpenerArming = false;
      this.#outboundOpenerDelivered = true;
      // Safety: never leave the mic muted if responseDone never arrives.
      setTimeout(() => {
        if (this.#closed || !this.#realtimeAwaitingOpener) return;
        this.emitLog('info', 'Opening S2S mic after opener timeout', undefined, 'realtime');
        this.#realtimeAwaitingOpener = false;
        this.#realtime?.enableAutoResponses();
      }, 8_000);
    } else {
      emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
      this.#listenStartedAt = Date.now();
    }
  }

  /**
   * True while model audio is still draining to the phone (Acefone queue).
   * Used for UI / hangup timing — NOT for muting the mic to Gemini.
   */
  #isRealtimeAgentOnWire(): boolean {
    if (this.#realtimeAwaitingOpener) return true;
    if (
      this.#speaking ||
      this.#realtimePlaybackOpen ||
      Boolean(this.#realtime?.hasActiveResponse()) ||
      Date.now() < this.#playbackUntil
    ) {
      return true;
    }
    return false;
  }

  /**
   * Half-duplex mute: only while the model is actively producing audio.
   * Waiting for Acefone drain (playbackUntil) delayed replies by seconds after
   * the caller already heard the agent stop.
   */
  #isRealtimeHalfDuplexMute(): boolean {
    if (this.#realtimeAwaitingOpener) return true;
    return (
      this.#speaking ||
      this.#realtimePlaybackOpen ||
      Boolean(this.#realtime?.hasActiveResponse())
    );
  }

  #onMediaRealtime(mulaw: Buffer, energy: number, frameMs: number): void {
    if (this.#trackQuietHangup(energy, frameMs)) return;

    if (energy >= LISTEN_ENERGY_THRESHOLD) {
      this.#listenHadEnergy = true;
      this.#lastVoicedAt = Date.now();
    }

    const agentPlaying = this.#isRealtimeHalfDuplexMute();

    // Listening: always stream caller audio to Gemini.
    if (!agentPlaying) {
      if (this.#s2sListenHadSpeech && this.#s2sListenBuf.length > 0) {
        this.emitLog(
          'info',
          `S2S flushing ${Math.round(this.#s2sListenBufMs)}ms buffered caller audio after agent stop`,
          undefined,
          'realtime',
        );
        this.#flushS2sListenBuf();
      } else {
        this.#clearS2sListenBuf();
      }
      this.#realtimeBargeEnergyMs = 0;
      this.#s2sEarlyListenMs = 0;
      this.#s2sEchoBaseline = 0;
      this.#s2sEchoBaselineFrozen = 0;
      this.#s2sEchoPeak = 0;
      this.#bargeEchoFloor = 0;
      this.#realtime?.appendMulaw8k(mulaw);

      // Local EOU: don't wait on Gemini VAD alone — nudge as soon as caller hushes.
      if (energy >= LISTEN_ENERGY_THRESHOLD) {
        this.#s2sOpenMicHadSpeech = true;
        this.#s2sOpenMicSpeechMs += frameMs;
        this.#s2sOpenMicSilenceMs = 0;
        this.#s2sOpenMicEouSent = false;
      } else if (this.#s2sOpenMicHadSpeech && !this.#s2sOpenMicEouSent) {
        this.#s2sOpenMicSilenceMs += frameMs;
        if (
          this.#s2sOpenMicSpeechMs >= S2S_LOCAL_EOU_MIN_SPEECH_MS &&
          this.#s2sOpenMicSilenceMs >= S2S_LOCAL_EOU_SILENCE_MS
        ) {
          this.#s2sOpenMicEouSent = true;
          this.#realtime?.signalAudioStreamEnd();
          this.emitLog(
            'info',
            `S2S local EOU — audioStreamEnd after ${Math.round(this.#s2sOpenMicSilenceMs)}ms hush`,
            undefined,
            'realtime',
          );
        }
      }
      return;
    }

    // Agent speaking — reset open-mic EOU; barge / early-listen paths below.
    this.#s2sOpenMicHadSpeech = false;
    this.#s2sOpenMicSpeechMs = 0;
    this.#s2sOpenMicSilenceMs = 0;
    this.#s2sOpenMicEouSent = false;

    // Agent on wire — half-duplex to Gemini. Hard spike → Acefone cut (real interrupt).
    const sinceSpeak = this.#audioStartedAt ? Date.now() - this.#audioStartedAt : 0;
    const openerProtected = this.#realtimeAwaitingOpener || this.#outboundOpenerArming;
    const inGuard =
      openerProtected ||
      (this.#audioStartedAt && sinceSpeak < S2S_BARGE_GUARD_MS) ||
      Date.now() < this.#s2sBargeCooldownUntil;

    // Always buffer voiced inbound so a late barge / responseDone can deliver it.
    if (energy >= LISTEN_ENERGY_THRESHOLD) {
      this.#pushS2sListenFrame(mulaw, frameMs);
      this.#s2sListenHadSpeech = true;
    }

    if (inGuard) {
      // Learn echo plateau + peak here — do not keep climbing after guard.
      if (this.#s2sEchoBaseline <= 0) {
        this.#s2sEchoBaseline = Math.max(S2S_ECHO_FLOOR_SEED, energy);
      } else {
        this.#s2sEchoBaseline =
          this.#s2sEchoBaseline * (1 - S2S_ECHO_EMA_ALPHA) + energy * S2S_ECHO_EMA_ALPHA;
      }
      this.#s2sEchoPeak = Math.max(this.#s2sEchoPeak * 0.97, energy);
      this.#bargeEchoFloor = this.#s2sEchoBaseline;
      this.#s2sEchoBaselineFrozen = 0;
      this.#realtimeBargeEnergyMs = 0;
      this.#s2sEarlyListenMs = 0;
      return;
    }

    // Freeze above typical echo (EMA + peak) so TTS volume swings do not false-cut.
    if (this.#s2sEchoBaselineFrozen <= 0) {
      this.#s2sEchoBaselineFrozen = Math.max(
        S2S_ECHO_FLOOR_SEED,
        this.#s2sEchoBaseline,
        this.#s2sEchoPeak * 0.9,
      );
      this.#s2sEchoBaseline = this.#s2sEchoBaselineFrozen;
    }
    const baseline = this.#s2sEchoBaselineFrozen;
    this.#bargeEchoFloor = baseline;

    // No early-stream while agent plays — echo kept Gemini VAD open and delayed replies.
    const hardThresh = Math.max(baseline * 1.28, baseline + 550, S2S_BARGE_MIN_THRESHOLD);

    if (energy >= hardThresh) {
      this.#realtimeBargeEnergyMs += frameMs;
      if (this.#realtimeBargeEnergyMs >= S2S_BARGE_SUSTAIN_MS) {
        this.#realtimeBargeEnergyMs = 0;
        this.#s2sEarlyListenMs = 0;
        this.#realtimeBargeIn(
          `local-energy energy=${Math.round(energy)} baseline=${Math.round(baseline)} thresh=${Math.round(hardThresh)}`,
        );
        this.#flushS2sListenBuf();
      }
      return;
    }

    // Drop partial hard-sustain quickly — short echo spikes must not accumulate.
    this.#realtimeBargeEnergyMs = Math.max(0, this.#realtimeBargeEnergyMs - frameMs * 0.8);
  }

  #pushS2sListenFrame(mulaw: Buffer, frameMs: number): void {
    this.#s2sListenBuf.push(Buffer.from(mulaw));
    this.#s2sListenBufMs += frameMs;
    const maxFrames = Math.max(8, Math.ceil(S2S_LISTEN_PREROLL_MS / Math.max(20, frameMs)));
    while (this.#s2sListenBuf.length > maxFrames) {
      this.#s2sListenBuf.shift();
      this.#s2sListenBufMs = Math.max(0, this.#s2sListenBufMs - Math.max(20, frameMs));
    }
  }

  #clearS2sListenBuf(): void {
    this.#s2sListenBuf = [];
    this.#s2sListenBufMs = 0;
    this.#s2sListenHadSpeech = false;
  }

  #flushS2sListenBuf(): void {
    if (!this.#s2sListenBuf.length) {
      this.#clearS2sListenBuf();
      return;
    }
    for (const frame of this.#s2sListenBuf) {
      this.#realtime?.appendMulaw8k(frame);
    }
    this.#listenHadEnergy = true;
    this.#lastVoicedAt = Date.now();
    this.#clearS2sListenBuf();
  }

  #playRealtimeMulawFrame(frame: Buffer): void {
    if (this.#closed || !this.#realtimePlaybackOpen) return;
    const now = Date.now();
    if (!this.#speaking) {
      this.#speaking = true;
      this.#audioStartedAt = now;
      this.#sentAudioMs = 0;
      this.#s2sEchoBaseline = Math.max(S2S_ECHO_FLOOR_SEED, this.#s2sEchoBaseline * 0.5);
      this.#s2sEchoBaselineFrozen = 0;
      this.#s2sEchoPeak = 0;
      this.#bargeEchoFloor = this.#s2sEchoBaseline;
      this.#realtimeBargeEnergyMs = 0;
      this.#s2sEarlyListenMs = 0;
      this.#clearS2sListenBuf();
      emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'speaking' });
    }
    this.#mediaChunk += 1;
    this.#send({
      event: 'media',
      streamSid: this.#streamSid,
      media: {
        payload: frame.toString('base64'),
        chunk: String(this.#mediaChunk),
      },
    });
    this.#sentAudioMs += 20;
    this.#playbackUntil = this.#audioStartedAt + this.#sentAudioMs;
  }

  #realtimeBargeIn(reason = 'barge-in'): void {
    // Never cut the outbound opener — phone echo was wiping the greeting.
    if (this.#realtimeAwaitingOpener || this.#outboundOpenerArming) {
      this.emitLog('info', 'Ignored local barge during opener', undefined, 'realtime');
      return;
    }
    if (!this.#speaking && !this.#realtime?.hasActiveResponse() && !this.#realtimePlaybackOpen) {
      // Still flush Acefone — leftover frames may be queued even if flags cleared.
      if (this.#streamSid) {
        this.#send({ event: 'clear', streamSid: this.#streamSid });
        this.#send({ event: 'clear', streamSid: this.#streamSid });
      }
      return;
    }
    this.#realtimePlaybackOpen = false;
    this.#speaking = false;
    this.#playbackUntil = 0;
    this.#echoMuteUntil = 0;
    this.#realtimeBargeEnergyMs = 0;
    this.#s2sEarlyListenMs = 0;
    // Keep echo floor so we do not immediately re-barge on residual acoustics.
    this.#s2sBargeCooldownUntil = Date.now() + S2S_BARGE_COOLDOWN_MS;
    this.#listenStartedAt = Date.now();
    this.#quietGraceUntil = Date.now() + QUIET_GRACE_AFTER_SELF_CUT_MS;
    this.#realtime?.cancelResponse();
    // Acefone/Twilio-compatible flush — repeat so late media cannot race the clear.
    this.#send({ event: 'clear', streamSid: this.#streamSid });
    this.#send({ event: 'clear', streamSid: this.#streamSid });
    this.#send({ event: 'clear', streamSid: this.#streamSid });
    setTimeout(() => {
      if (this.#closed || this.#speaking) return;
      this.#send({ event: 'clear', streamSid: this.#streamSid });
    }, 40);
    this.#openAgentLineId = null;
    const line = `S2S barge-in — agent stopped (${reason})`;
    console.log('[telephony]', line);
    this.emitLog('info', line, undefined, 'realtime');
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
  }

  #scheduleRealtimeHangup(reason: string): void {
    this.#pendingRealtimeHangupReason = reason || 'end_call';
    this.emitLog(
      'info',
      `S2S hangup requested (${this.#pendingRealtimeHangupReason}) — waiting for goodbye audio`,
      undefined,
      'realtime',
    );
    if (this.#pendingRealtimeHangupTimer) clearTimeout(this.#pendingRealtimeHangupTimer);
    // Fallback: if goodbye already finished (no more responseDone), still hang up.
    const fallbackMs =
      this.#speaking || this.#realtime?.hasActiveResponse() ? 6_000 : 1_500;
    this.#pendingRealtimeHangupTimer = setTimeout(() => {
      this.#pendingRealtimeHangupTimer = undefined;
      const pending = this.#pendingRealtimeHangupReason;
      this.#pendingRealtimeHangupReason = null;
      if (pending && !this.#closed && !this.#hangupSent) {
        void this.requestHangup(pending);
      }
    }, fallbackMs);
  }

  #flushPendingRealtimeHangup(): void {
    const reason = this.#pendingRealtimeHangupReason;
    if (!reason || this.#closed || this.#hangupSent) return;
    if (this.#pendingRealtimeHangupTimer) clearTimeout(this.#pendingRealtimeHangupTimer);
    // Let the last chunk of goodbye audio reach the phone before Smartflo hangup.
    const waitMs = Math.max(900, Math.min(2_500, this.#playbackUntil - Date.now() + 700));
    this.#pendingRealtimeHangupTimer = setTimeout(() => {
      this.#pendingRealtimeHangupTimer = undefined;
      this.#pendingRealtimeHangupReason = null;
      if (!this.#closed && !this.#hangupSent) {
        void this.requestHangup(reason);
      }
    }, waitMs);
  }

  #send(obj: Record<string, unknown>): void {
    if (this.#ws.readyState === this.#ws.OPEN) {
      this.#ws.send(JSON.stringify(obj));
    }
  }

  async #runOutboundAmd(): Promise<'human' | 'voicemail'> {
    if (!isVoicemailDetectionEnabled()) return 'human';

    this.#amdActive = true;
    this.#amdHeard = '';
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'listening' });
    this.emitLog('info', `Voicemail detection listening (${resolveAmdTimeoutMs()}ms)`, undefined, 'pipeline');

    return new Promise<'human' | 'voicemail'>((resolve) => {
      this.#amdResolve = resolve;
      this.#amdTimer = setTimeout(() => {
        void this.#finishAmd('human', 'timeout');
      }, resolveAmdTimeoutMs());
    });
  }

  #finishAmd(result: 'human' | 'voicemail', reason: string): void {
    if (!this.#amdActive) return;
    this.#amdActive = false;
    if (this.#amdTimer) clearTimeout(this.#amdTimer);
    this.#amdTimer = undefined;
    this.emitLog('info', `AMD ${result} (${reason})`, { heard: this.#amdHeard.slice(0, 160) }, 'pipeline');
    if (result === 'human' && this.#callDirection === 'outbound' && !this.#outboundOpenerDelivered) {
      this.#outboundOpenerArming = true;
    }
    const resolve = this.#amdResolve;
    this.#amdResolve = undefined;
    resolve?.(result);
  }

  async #handleAmdSpeech(text: string, final: boolean): Promise<void> {
    if (!this.#amdActive || this.#closed) return;
    this.#amdHeard = `${this.#amdHeard} ${text}`.trim();
    if (final) this.#publishUserTranscript(text);

    const kind = classifyAmdSpeech(text, {
      cumulative: this.#amdHeard,
      connectedMs: this.#connectedAt ? Date.now() - this.#connectedAt : 0,
    });
    if (kind === 'human') {
      this.#finishAmd('human', `heard: ${text.slice(0, 80)}`);
      return;
    }
    if (kind === 'voicemail' && (final || text.length >= 40)) {
      this.#finishAmd('voicemail', `heard: ${text.slice(0, 80)}`);
    }
  }

  async #leaveVoicemailMessage(): Promise<void> {
    if (!this.#agent || this.#closed) return;
    const skills = mergeSkillsConfig(this.#agent.skillsConfig);
    const template = skills.core?.voicemail.messageScript?.trim();
    const message = template
      ? buildVoicemailMessage(template, this.#agent.name, this.#agent.productName, this.#agent.agentGender)
      : defaultVoicemailScript(this.#agent.name, this.#agent.productName);

    await prisma.call.update({
      where: { id: this.#callId },
      data: { outcome: 'voicemail_left' },
    }).catch(() => undefined);

    emitTelephonyEvent(this.#callId, {
      type: 'log',
      level: 'info',
      category: 'pipeline',
      message: 'Voicemail detected — leaving message',
    });
    emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });

    const beepWait = resolveVoicemailBeepWaitMs();
    if (beepWait > 0) {
      this.emitLog('info', `Waiting ${beepWait}ms for voicemail beep`);
      await sleep(beepWait);
    }

    await this.#runSpokenTurn(
      async () => ({
        text: message,
        usage: { promptTokens: 0, completionTokens: 0, ttftMs: 0 },
      }),
      { scripted: true },
    );

    if (!this.#closed) {
      await this.requestHangup('voicemail');
    }
  }

  async #onStop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelSilenceWatch();
    this.#clearDeadMediaWatch();
    this.#clearHeard();
    this.#turnAbort?.abort();
    await this.#stt?.close();
    this.#realtime?.close();
    this.#realtime = null;
    unregisterCallSession(this.#callId, this);

    await prisma.call.update({
      where: { id: this.#callId },
      data: { status: 'completed', endedAt: new Date() },
    }).catch(() => undefined);
    emitTelephonyEvent(this.#callId, { type: 'status', status: 'completed' });

    const metrics = this.#metrics.snapshot();
    const apiUrl = internalApiUrl();
    try {
      await fetch(`${apiUrl}/api/calls/${this.#callId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: { lines: this.#transcript, metrics },
          outcome: 'completed',
          status: 'completed',
        }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch (err) {
      console.error('[telephony] transcript save failed', err);
      this.emitLog('error', 'Failed to save transcript');
    }

    this.emitLog('info', 'Call completed', { turns: metrics.userTurns + metrics.agentTurns }, 'ws');
    if (this.#ws.readyState === this.#ws.OPEN) {
      this.#ws.close(1000, 'call-ended');
    }
  }

  async requestHangup(reason = 'agent_end_call'): Promise<void> {
    if (this.#hangupSent) {
      await this.#onStop();
      return;
    }
    this.#hangupSent = true;
    const line = `Conversation complete — hanging up (${reason})`;
    console.log('[telephony]', line);
    this.emitLog('info', line, undefined, 'ws');

    let callSid = this.#callSid.trim();
    let refId = this.#acefoneRefId.trim();
    if (!callSid || !refId) {
      const row = await prisma.call
        .findUnique({ where: { id: this.#callId }, select: { externalCallId: true } })
        .catch(() => null);
      const stored = row?.externalCallId?.trim() || '';
      if (stored) {
        if (looksLikeSmartfloRefId(stored)) {
          if (!refId) refId = stored;
        } else if (!callSid) {
          callSid = stored;
        }
      }
    }

    if (callSid || refId) {
      try {
        const used = await hangupSmartfloWithCandidates(callSid, refId);
        this.emitLog('info', 'Smartflo hangup OK', { used }, 'smartflo');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Hangup API failed';
        console.warn('[telephony]', message);
        this.emitLog('warn', message, undefined, 'smartflo');
      }
    } else {
      this.emitLog('warn', 'Hangup skipped — no callSid/refId', undefined, 'smartflo');
    }

    if (this.#ws.readyState === this.#ws.OPEN) {
      this.#ws.close(1000, 'hangup');
    }
    await this.#onStop();
  }

  close(): void {
    if (this.#closed) return;
    // WS drop must still cut the PSTN leg when Acefone leaves the phone bridged.
    if (!this.#hangupSent) {
      void this.requestHangup('ws_close');
      return;
    }
    void this.#onStop();
  }
}
