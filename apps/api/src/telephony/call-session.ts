import type WebSocket from 'ws';
/**
 * Smartflo / Acefone phone call session.
 * Voice path: Gemini Live S2S only (appliedPipeline is always gemini_live).
 */
import {
  buildOutboundOpenerInstructions,
  buildGeminiLiveS2sInstructionSupplement,
  isGemini31LiveModel,
  preferGeminiLiveModelForTelephony,
  resolveGeminiLiveModel,
  buildCallTimeContextPrompt,
  appendHinglishGenderLock,
  mergeSkillsConfig,
  resolvePackForBooking,
  normalizeRealtimeS2sUserConfig,
  refreshLanguagePrompt,
  DEFAULT_CORE_SKILLS,
  looksLikeHumanReply,
  looksLikeVoicemailPrompt,
  SILENCE_CHECK_MS,
  silenceStep,
  type CallDirection,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';
import { hangupSmartfloWithCandidates, looksLikeSmartfloRefId } from './acefone-client.js';
import { prisma } from '../db.js';
import { authHeadersForServerFetch } from '../auth.js';
import { emitTelephonyEvent, clearTelephonyEventBuffer } from './event-bus.js';
import { internalApiUrl } from './internal-api.js';
import {
  fetchRuntimeAgent,
  takePrefetchedRuntime,
  telephonyLlmLabel,
  type RuntimeAgentPayload,
} from './llm-client.js';
import { clearPendingCall, getPendingCall, normalizeCallId } from './call-registry.js';
import { readTelephonySessionPayload, resolveTelephonyAppliedPipeline, normalizeTelephonyPipelineMode } from './session-config.js';
import { TelephonyGeminiLiveClient } from './telephony-gemini-live-client.js';
import { TelephonyMetricsAccumulator } from './metrics.js';
import { mulawToPcm16 } from './mulaw.js';
import { registerCallSession, unregisterCallSession } from './session-registry.js';

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pcmAvgEnergy(pcm: Buffer): number {
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
  return energy / (pcm.length / 2 || 1);
}

const LISTEN_ENERGY_THRESHOLD = 250;
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
/** S2S: absolute minimum energy for hard cut. */
const S2S_BARGE_MIN_THRESHOLD = 1180;
/** Seed EMA baseline when agent starts — phone always returns some TTS echo. */
const S2S_ECHO_FLOOR_SEED = 1650;
/** After a barge, ignore further cuts briefly (prevents silent cut-loop). */
const S2S_BARGE_COOLDOWN_MS = 1_000;
/** Keep recent inbound mulaw while agent talks — flush on barge / agent stop. */
const S2S_LISTEN_PREROLL_MS = 1_400;
/** EMA adapt rate while learning echo in the guard window. */
const S2S_ECHO_EMA_ALPHA = 0.2;

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
  #transcript: TranscriptLine[] = [];
  #mediaChunk = 0;
  #speaking = false;
  #closed = false;
  #prospectName?: string;
  #contactPhone?: string;
  #contactEmail?: string;
  #metrics = new TelephonyMetricsAccumulator();
  #callDirection: CallDirection = 'outbound';
  #listenStartedAt = 0;
  #connectedAt = 0;
  #mediaCount = 0;
  #loggedMediaShape = false;
  #playbackUntil = 0;
  #audioStartedAt = 0;
  #sentAudioMs = 0;
  #listenHadEnergy = false;
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
  #bargeEchoFloor = 0;
  #hasInboundTrack = false;
  #hangupSent = false;
  #pendingRealtimeHangupReason: string | null = null;
  #pendingRealtimeHangupTimer: ReturnType<typeof setTimeout> | undefined;
  #lastInboundAt = 0;
  #lastVoicedAt = 0;
  #quietMs = 0;
  #quietGraceUntil = 0;
  #deadMediaTimer: ReturnType<typeof setTimeout> | undefined;
  /** Live user transcript line id — fold updates this row instead of appending a snowball. */
  #openUserLineId: string | null = null;
  /** Concat of finalized user lines — strip if Gemini resends cumulative history. */
  #committedUserTranscript = '';
  /** Live agent transcript line id for S2S streaming updates. */
  #openAgentLineId: string | null = null;
  /** Prevents duplicate Smartflo `start` events from replaying opener. */
  #pipelineStarted = false;
  /** Outbound opener in flight — pickup hello must not abort it. */
  #outboundOpenerArming = false;
  #outboundOpenerDelivered = false;
  #realtime: TelephonyGeminiLiveClient | null = null;
  #realtimeAwaitingOpener = false;
  #realtimeOpenerRetried = false;
  #geminiRecovering = false;
  #silenceChecks = 0;
  #silenceEnded = false;
  #voicemailHandled = false;
  #silenceTimer: ReturnType<typeof setTimeout> | undefined;

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
        select: { voicePipeline: true, realtimeVoice: true, realtimeS2sConfig: true },
      });
      const appliedPipeline =
        telephonySession?.appliedPipeline ??
        resolveTelephonyAppliedPipeline(pipelineMode, agentRow?.voicePipeline);
      const s2sPipeline = 'gemini_live' as const;
      const studioRealtimeS2s = normalizeRealtimeS2sUserConfig(
        {
          ...((agentRow?.realtimeS2sConfig &&
          typeof agentRow.realtimeS2sConfig === 'object'
            ? agentRow.realtimeS2sConfig
            : {}) as Partial<RealtimeS2sUserConfig>),
          ...(agentRow?.realtimeVoice ? { voice: agentRow.realtimeVoice } : {}),
          ...(telephonySession?.realtimeS2sConfig ?? {}),
        },
        s2sPipeline,
      );

      this.emitLog('info', `Agent loaded: ${this.#agent.name}`, {
        llm: telephonyLlmLabel(this.#agent),
        prefetched: Boolean(prefetched),
        voicePipeline: appliedPipeline,
        pipelineMode,
        realtimeVoice:
          studioRealtimeS2s.voice ??
          telephonySession?.realtimeS2sConfig?.voice ??
          agentRow?.realtimeVoice,
        s2sModel: studioRealtimeS2s.model,
      });

      await this.#startRealtimePipeline(
        {
          ...studioRealtimeS2s,
          ...(agentRow?.realtimeVoice ? { voice: agentRow.realtimeVoice } : {}),
        },
        direction === 'inbound' ? 'inbound' : 'outbound',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'onStart pipeline failed';
      console.error('[telephony] onStart pipeline failed', err);
      this.emitLog('error', message);
      emitTelephonyEvent(this.#callId, { type: 'error', message });
      // Gemini Live is the only voice path — never fall back to cascaded STT/TTS.
      void this.requestHangup('s2s_connect_failed');
    }
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
    this.#onMediaRealtime(mulaw, energy, frameMs);
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
    if (this.#isRealtimeAgentOnWire()) {
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
    if (this.#isRealtimeAgentOnWire()) {
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
    if (!this.#audioStartedAt || this.#quietMs < DEAD_LINE_MS) return false;
    this.emitLog('info', `Inbound quiet for ${Math.round(this.#quietMs)}ms after remote hangup — ending call`);
    this.#quietMs = 0;
    void this.requestHangup('remote_quiet');
    return true;
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
    }
  }

  /** After Gemini Live 1011 / unexpected close — reconnect once, else end the call. */
  async #recoverGeminiLiveConnection(detail: string): Promise<void> {
    if (this.#closed || this.#geminiRecovering) return;
    const client = this.#realtime;
    if (!(client instanceof TelephonyGeminiLiveClient)) return;

    this.#geminiRecovering = true;
    this.#speaking = false;
    this.#realtimePlaybackOpen = false;
    this.#realtimeAwaitingOpener = false;
    this.emitLog('warn', `Gemini Live lost (${detail}) — attempting reconnect`, undefined, 'realtime');
    emitTelephonyEvent(this.#callId, {
      type: 'log',
      level: 'warn',
      category: 'realtime',
      message: `Gemini Live disconnected (${detail}) — reconnecting…`,
    });

    try {
      // Brief pause — immediate reconnect often hits the same 1011.
      await new Promise((r) => setTimeout(r, 450));
      if (this.#closed) return;

      const ok = await client.reconnect();
      if (ok && !this.#closed) {
        const lastUser = [...this.#transcript]
          .reverse()
          .find((l) => l.role === 'user' && l.text.trim() && !/^<noise>/i.test(l.text.trim()));
        const cityHint = lastUser?.text?.trim().slice(0, 120) || '';
        const resume =
          `SYSTEM: The voice session briefly dropped. Continue the same outbound call seamlessly. ` +
          `Do not re-greet. The caller last said: "${cityHint || '(unclear)'}". ` +
          `If that is a city (e.g. Udaipur), acknowledge it and continue the stay booking flow ` +
          `(ask dates / rooms / next needed field). Keep one short Hinglish sentence.`;
        client.enableAutoResponses();
        client.createResponse(resume);
        this.emitLog('info', 'Gemini Live reconnected — resumed turn', undefined, 'realtime');
        emitTelephonyEvent(this.#callId, { type: 'agent_state', state: 'thinking' });
        return;
      }

      this.emitLog(
        'warn',
        'Gemini Live reconnect failed — ending call',
        undefined,
        'realtime',
      );
      await this.#endCallAfterGeminiFailure(detail);
    } finally {
      this.#geminiRecovering = false;
    }
  }

  /** Gemini is the only voice path — on unrecoverable loss, hang up cleanly. */
  async #endCallAfterGeminiFailure(detail: string): Promise<void> {
    if (this.#closed) return;

    this.emitLog(
      'error',
      `Gemini Live failed after reconnect — hanging up (${detail})`,
      undefined,
      'realtime',
    );
    emitTelephonyEvent(this.#callId, {
      type: 'log',
      level: 'error',
      category: 'realtime',
      message: `Gemini Live failed — ending call (${detail})`,
    });
    emitTelephonyEvent(this.#callId, {
      type: 'error',
      message: `Gemini Live connection lost: ${detail}`,
    });

    try {
      this.#realtime?.close();
    } catch {
      /* ignore */
    }
    this.#realtime = null;
    this.#speaking = false;
    this.#realtimePlaybackOpen = false;
    this.#realtimeAwaitingOpener = false;

    if (!this.#closed) {
      await this.requestHangup('gemini_live_failed');
    }
  }

  #silenceLines(): { check: string; bye: string; vm: string } {
    const skills = mergeSkillsConfig(this.#agent?.skillsConfig);
    const core = skills.core ?? DEFAULT_CORE_SKILLS;
    const agentName = this.#agent?.name?.trim() || 'main';
    const product = this.#agent?.productName?.trim() || 'yahan se';
    return {
      check: core.silence.checkInLine,
      bye: core.silence.goodbyeLine,
      vm: core.voicemail.messageScript
        .replaceAll('{agent_name}', agentName)
        .replaceAll('{product_name}', product),
    };
  }

  #armSilence(): void {
    if (this.#silenceTimer) clearTimeout(this.#silenceTimer);
    if (this.#closed || this.#silenceEnded) return;
    this.#silenceTimer = setTimeout(() => void this.#onSilenceTick(), SILENCE_CHECK_MS);
  }

  async #sayExact(line: string): Promise<void> {
    this.#realtime?.createResponse(
      `SYSTEM: Say exactly this one sentence to the caller now, then stop. Do not add a question:\n${line}`,
    );
  }

  async #onSilenceTick(): Promise<void> {
    this.#silenceTimer = undefined;
    if (this.#closed || this.#silenceEnded) return;
    const lines = this.#silenceLines();
    const step = silenceStep(this.#silenceChecks);
    this.#silenceChecks += 1;
    await this.#sayExact(lines.check);
    if (step === 'check_then_end') {
      this.#silenceEnded = true;
      await this.#sayExact(lines.bye);
      this.#scheduleRealtimeHangup('silence');
      return;
    }
    this.#armSilence();
  }

  #onCallerForSilence(text: string): void {
    if (this.#silenceEnded || this.#closed) return;
    if (looksLikeVoicemailPrompt(text)) {
      if (this.#voicemailHandled) return;
      this.#voicemailHandled = true;
      this.#silenceEnded = true;
      if (this.#silenceTimer) clearTimeout(this.#silenceTimer);
      const lines = this.#silenceLines();
      void this.#sayExact(lines.vm).then(() => this.#scheduleRealtimeHangup('voicemail'));
      return;
    }
    if (!looksLikeHumanReply(text)) return;
    this.#silenceChecks = 0;
    if (this.#silenceTimer) clearTimeout(this.#silenceTimer);
    this.#silenceTimer = undefined;
  }

  #onAgentForSilence(text: string): void {
    if (this.#silenceEnded || this.#closed) return;
    const lines = this.#silenceLines();
    if (
      text === lines.check ||
      text === lines.bye ||
      text === lines.vm ||
      /awaz aa rehi|awaaz aa rahi|disconnect kar|callback kar lijiye/i.test(text)
    ) {
      return;
    }
    this.#silenceChecks = 0;
    this.#armSilence();
  }

  async #startRealtimePipeline(
    s2sConfig: Partial<RealtimeS2sUserConfig> | undefined,
    direction: CallDirection,
  ): Promise<void> {
    const agent = this.#agent!;
    const config = normalizeRealtimeS2sUserConfig(s2sConfig ?? {}, 'gemini_live');
    const beforeModel = config.model;
    config.model = preferGeminiLiveModelForTelephony(resolveGeminiLiveModel(config.model));
    if (beforeModel !== config.model) {
      console.log(
        '[telephony]',
        `Gemini Live phone model ${beforeModel} → ${config.model} (GEMINI_LIVE_FORCE_25_ON_PHONE=1)`,
      );
    }
    // Phone VAD: keep snappy, but never clamp to ~100ms — that races with local
    // audioStreamEnd and crashes Gemini Live (WS 1011) after short answers like city names.
    const is31 = isGemini31LiveModel(config.model);
    config.turnDetectionPrefixPaddingMs = Math.min(
      Math.max(config.turnDetectionPrefixPaddingMs || 80, 60),
      is31 ? 120 : 100,
    );
    config.turnDetectionSilenceDurationMs = Math.min(
      Math.max(config.turnDetectionSilenceDurationMs || 220, 180),
      is31 ? 320 : 280,
    );
    const supplement = buildGeminiLiveS2sInstructionSupplement(
      config.voice,
      config.model,
      resolvePackForBooking(mergeSkillsConfig(agent.skillsConfig).booking).s2sRules,
    ).replace(
      /\(Simulator only\)/gi,
      '(Phone call)',
    );
    const callTimeBlock = buildCallTimeContextPrompt();
    const geminiPromptCap = isGemini31LiveModel(config.model) ? 3200 : 3000;
    const body = appendHinglishGenderLock(
      `${refreshLanguagePrompt(agent.compiledSystemPrompt, agent.voiceLanguages)}${supplement}`,
      agent.agentGender,
      Math.max(1800, geminiPromptCap - callTimeBlock.length - 20),
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
      `Starting gemini_live model=${config.model} voice=${config.voice} silenceMs=${config.turnDetectionSilenceDurationMs}`,
    );

    const callbacks = {
      onAudioMulaw: (frame: Buffer) => this.#playRealtimeMulawFrame(frame),
      onUserTranscript: (text: string, final: boolean) => {
        if (!text.trim()) return;
        this.#publishUserTranscript(text.trim(), final);
        if (final) {
          this.#onCallerForSilence(text.trim());
          emitTelephonyEvent(this.#callId, { type: 'usage', ...this.#metrics.usageSnapshot() });
        }
      },
      onAgentTranscript: (text: string, final: boolean) => {
        if (!text.trim()) return;
        this.#publishAgentTranscript(text.trim(), final);
        if (final) {
          this.#onAgentForSilence(text.trim());
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
      onConnectionLost: (detail: string) => {
        void this.#recoverGeminiLiveConnection(detail);
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

    await this.#realtime.connect();
    this.emitLog(
      'info',
      `Gemini Live S2S on phone: model=${config.model} voice=${config.voice} lang=${config.languageCode}`,
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

      // Local audioStreamEnd races Gemini server VAD on phone and causes Live 1011.
      // Rely on Gemini automaticActivityDetection only.
      if (energy >= LISTEN_ENERGY_THRESHOLD) {
        this.#s2sOpenMicHadSpeech = true;
        this.#s2sOpenMicSpeechMs += frameMs;
        this.#s2sOpenMicSilenceMs = 0;
        this.#s2sOpenMicEouSent = false;
      } else {
        this.#s2sOpenMicSilenceMs += frameMs;
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


  async #onStop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#silenceTimer) clearTimeout(this.#silenceTimer);
    this.#silenceTimer = undefined;
    this.#clearDeadMediaWatch();
    this.#realtime?.close();
    this.#realtime = null;
    unregisterCallSession(this.#callId, this);
    clearPendingCall(this.#callId);

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
        headers: { 'Content-Type': 'application/json', ...authHeadersForServerFetch() },
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
    } finally {
      clearTelephonyEventBuffer(this.#callId);
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
