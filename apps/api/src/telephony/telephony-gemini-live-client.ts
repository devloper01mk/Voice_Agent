import { ActivityHandling, EndSensitivity, GoogleGenAI, Modality, StartSensitivity, ThinkingLevel, type Session, VoiceActivityType } from '@google/genai';
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_SPOKEN_TURN_MAX_TOKENS,
  authoritySpeakInstruction,
  bindNegotiationPolicy,
  commercialSpeechViolatesAuthority,
  evaluateNegotiationForCall,
  geminiLiveThinkingConfig,
  negotiationFallback,
  normalizeRealtimeS2sUserConfig,
  planDirectGeminiAudio,
  spokenAuthorityFromDecision,
  type SpokenAuthority,
  resolveGeminiLiveModel,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';
import { downsampleTo8k, mulawToPcm16, pcm16ToMulaw, upsample8kTo16k } from './mulaw.js';
import {
  createTelephonyTools,
  executeTelephonyTool,
  type TelephonyToolContext,
  type TelephonyToolDef,
} from './telephony-tools.js';

const OUTPUT_SAMPLE_RATE = 24000;
const MULAW_FRAME_BYTES = 160;

export type TelephonyGeminiLiveCallbacks = {
  onAudioMulaw?: (frame: Buffer) => void;
  onUserTranscript?: (text: string, final: boolean) => void;
  onAgentTranscript?: (text: string, final: boolean) => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  onResponseStarted?: () => void;
  onResponseDone?: () => void;
  /** Server flagged that the user interrupted model generation — stop local playback.
   *  Return `'ignore'` to keep playing (e.g. outbound opener echo false-positive). */
  onInterrupted?: () => 'ignore' | void;
  /** Model asked to hang up (end_call). Finish goodbye audio, then disconnect. */
  onHangupRequested?: (reason: string) => void;
  /** Live socket dropped mid-call (e.g. 1011). Session may attempt one reconnect. */
  onConnectionLost?: (detail: string) => void;
  onUsage?: (usage: {
    inputTextTokens: number;
    inputAudioTokens: number;
    outputTextTokens: number;
    outputAudioTokens: number;
    totalTokens: number;
  }) => void;
  onError?: (message: string) => void;
  onLog?: (message: string, detail?: unknown) => void;
};

function toGeminiTools(tools: TelephonyToolDef[]) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parametersJsonSchema: tool.function.parameters,
      })),
    },
  ];
}

export class TelephonyGeminiLiveClient {
  #session: Session | null = null;
  #closed = false;
  #callbacks: TelephonyGeminiLiveCallbacks;
  #config: RealtimeS2sUserConfig;
  #instructions: string;
  #toolCtx: TelephonyToolContext | null;
  #agentTranscriptBuf = '';
  #userTranscriptBuf = '';
  #mulawRemainder = Buffer.alloc(0);
  #autoRespond: boolean;
  #responseActive = false;
  #responsePending = false;
  /** Drop model audio after local barge-in until the interrupted turn ends. */
  #suppressOutput = false;
  /** Bumps on each interrupt so delayed suppress-clear cannot reopen a stale turn. */
  #suppressEpoch = 0;
  /** Wall-clock until which leftover interrupted audio must stay dropped. */
  #suppressUntil = 0;
  /**
   * After local barge, hold ALL model audio until generationComplete/turnComplete.
   * A short suppress window (1.2s) was letting the old reply resume mid-call.
   */
  #bargeHold = false;
  /** Drop the unguided Gemini generation until Nexora has authorized speech. */
  #holdCommercialAudio = false;
  #authorityQueued = false;
  #commercialCommitted = false;
  #callerTurnText = '';
  #commercialReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  #spokenAuthority: SpokenAuthority | null = null;
  /** Inbound mulaw forwarded since last audioStreamEnd (avoid empty EOU nudges). */
  #userMulawBytesSinceEou = 0;
  #lastAudioStreamEndAt = 0;
  #apiKey = '';
  #model = '';
  #reconnectAttempts = 0;
  static readonly MAX_RECONNECTS = 1;
  static readonly MAX_TOOL_RESPONSE_CHARS = 3_500;

  constructor(opts: {
    config: Partial<RealtimeS2sUserConfig>;
    instructions: string;
    autoRespond?: boolean;
    toolContext?: TelephonyToolContext | null;
    callbacks: TelephonyGeminiLiveCallbacks;
  }) {
    this.#config = normalizeRealtimeS2sUserConfig({ ...opts.config, provider: 'gemini' }, 'gemini_live');
    this.#instructions = opts.instructions;
    this.#autoRespond = opts.autoRespond !== false;
    this.#toolCtx = opts.toolContext ?? null;
    this.#callbacks = opts.callbacks;
  }

  get config(): RealtimeS2sUserConfig {
    return this.#config;
  }

  hasActiveResponse(): boolean {
    return this.#responseActive || this.#responsePending;
  }

  enableAutoResponses(): void {
    this.#autoRespond = true;
  }

  /** Nudge Gemini that the caller finished speaking (local EOU). */
  signalAudioStreamEnd(): void {
    if (!this.#session || this.#closed) return;
    if (this.#responseActive || this.#responsePending) {
      this.#callbacks.onLog?.('audioStreamEnd skipped — model response in flight');
      return;
    }
    // ~350ms of 8k mulaw — short city names need room; empty EOU crashes Live (1011).
    const minMulaw = 2_800;
    if (this.#userMulawBytesSinceEou < minMulaw) {
      this.#callbacks.onLog?.(
        `audioStreamEnd skipped — only ${this.#userMulawBytesSinceEou}B user audio since last EOU`,
      );
      return;
    }
    const now = Date.now();
    if (now - this.#lastAudioStreamEndAt < 900) return;
    try {
      this.#session.sendRealtimeInput({ audioStreamEnd: true });
      this.#lastAudioStreamEndAt = now;
      this.#userMulawBytesSinceEou = 0;
    } catch (err) {
      this.#callbacks.onError?.(
        `audioStreamEnd failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async connect(): Promise<void> {
    const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required for Gemini Live S2S');

    const requested = resolveGeminiLiveModel(this.#config.model);
    this.#config = { ...this.#config, model: requested };
    this.#apiKey = apiKey;

    try {
      await this.#connectWithModel(apiKey, requested);
      this.#model = this.#config.model;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (requested !== DEFAULT_GEMINI_LIVE_MODEL) {
        this.#callbacks.onLog?.(
          `Gemini Live model "${requested}" failed (${message}) — falling back to ${DEFAULT_GEMINI_LIVE_MODEL}`,
        );
        this.#config = { ...this.#config, model: DEFAULT_GEMINI_LIVE_MODEL };
        await this.#connectWithModel(apiKey, DEFAULT_GEMINI_LIVE_MODEL);
        this.#model = DEFAULT_GEMINI_LIVE_MODEL;
        return;
      }
      throw err instanceof Error ? err : new Error(message);
    }
  }

  /** One mid-call reconnect after an unexpected Live close (e.g. 1011). */
  async reconnect(): Promise<boolean> {
    if (this.#closed) return false;
    if (this.#reconnectAttempts >= TelephonyGeminiLiveClient.MAX_RECONNECTS) return false;
    if (!this.#apiKey) return false;
    this.#reconnectAttempts += 1;
    // Prefer default 2.5 model on recover — 3.1 / flaky sessions often 1011 again.
    const model = DEFAULT_GEMINI_LIVE_MODEL;
    this.#config = { ...this.#config, model };
    this.#model = model;
    this.#callbacks.onLog?.(
      `Gemini Live reconnect attempt ${this.#reconnectAttempts}/${TelephonyGeminiLiveClient.MAX_RECONNECTS} (${model})`,
    );
    try {
      void this.#session?.close();
    } catch {
      /* ignore */
    }
    this.#session = null;
    this.#responseActive = false;
    this.#responsePending = false;
    this.#suppressOutput = false;
    this.#bargeHold = false;
    this.#holdCommercialAudio = false;
    this.#authorityQueued = false;
    this.#commercialCommitted = false;
    this.#callerTurnText = '';
    this.#mulawRemainder = Buffer.alloc(0);
    this.#userMulawBytesSinceEou = 0;
    try {
      // Shorter instructions reduce Live setup crashes after a mid-call 1011.
      const saved = this.#instructions;
      this.#instructions = saved.length > 2800 ? `${saved.slice(0, 2800)}\n…` : saved;
      await this.#connectWithModel(this.#apiKey, model);
      this.#instructions = saved;
      this.#autoRespond = true;
      return true;
    } catch (err) {
      this.#callbacks.onError?.(
        `Gemini Live reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async #connectWithModel(apiKey: string, model: string): Promise<void> {
    const ai = new GoogleGenAI({ apiKey });
    const speechConfig =
      this.#config.languageCode && this.#config.languageCode !== 'auto'
        ? {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: this.#config.voice },
            },
            languageCode: this.#config.languageCode,
          }
        : {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: this.#config.voice },
            },
          };

    const knownContact =
      this.#toolCtx?.prospectName || this.#toolCtx?.contactPhone || this.#toolCtx?.contactEmail
        ? {
            name: this.#toolCtx.prospectName,
            phone: this.#toolCtx.contactPhone,
            email: this.#toolCtx.contactEmail,
          }
        : undefined;
    const toolDefs = createTelephonyTools(knownContact, this.#toolCtx?.bookingPolicy);
    const rawThinking = geminiLiveThinkingConfig(model);
    const thinkingConfig = (() => {
      if (!rawThinking) return undefined;
      if ('thinkingBudget' in rawThinking) return rawThinking;
      if ('thinkingLevel' in rawThinking) {
        const map: Record<string, ThinkingLevel> = {
          minimal: ThinkingLevel.MINIMAL,
          low: ThinkingLevel.LOW,
          medium: ThinkingLevel.MEDIUM,
          high: ThinkingLevel.HIGH,
        };
        return { thinkingLevel: map[rawThinking.thinkingLevel] ?? ThinkingLevel.LOW };
      }
      return undefined;
    })();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };

      const timer = setTimeout(() => {
        finish(new Error(`Gemini Live setup timeout (${model})`));
      }, 15_000);

      void ai.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: { parts: [{ text: this.#instructions }] },
            speechConfig,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: toGeminiTools(toolDefs),
            ...(thinkingConfig ? { thinkingConfig } : {}),
            maxOutputTokens:
              this.#config.maxTokensMode === 'custom'
                ? this.#config.maxTokensCustom
                : DEFAULT_SPOKEN_TURN_MAX_TOKENS,
            // Always keep server VAD on so user audio is heard; outbound opener
            // still uses createResponse for the first spoken line.
            realtimeInputConfig: {
              // Phone echo must NOT cut model audio — we barge locally + Acefone clear.
              activityHandling: ActivityHandling.NO_INTERRUPTION,
              automaticActivityDetection: {
                // HIGH: pick up caller turn faster once mic is open (half-duplex
                // already blocks echo while we pump agent audio).
                startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH,
                prefixPaddingMs: this.#config.turnDetectionPrefixPaddingMs,
                silenceDurationMs: this.#config.turnDetectionSilenceDurationMs,
              },
            },
          },
          callbacks: {
            onopen: () => this.#callbacks.onLog?.(`Gemini Live connected (${model})`),
            onerror: (event) => {
              const message = event?.error?.message ?? 'Gemini Live WebSocket error';
              if (!settled) finish(new Error(`${message} [model=${model}]`));
              else this.#callbacks.onError?.(message);
            },
            onclose: (event) => {
              if (!settled) {
                finish(
                  new Error(
                    `Gemini Live closed before setup (${event?.reason || 'unknown'}) [model=${model}]`,
                  ),
                );
              } else if (!this.#closed) {
                const detail = [
                  event?.reason || 'unknown',
                  typeof event?.code === 'number' ? `code=${event.code}` : '',
                ]
                  .filter(Boolean)
                  .join(', ');
                console.error('[telephony] Gemini Live WebSocket closed', detail);
                this.#session = null;
                this.#responseActive = false;
                this.#responsePending = false;
                this.#callbacks.onConnectionLost?.(detail);
                this.#callbacks.onError?.(`Gemini Live WebSocket closed (${detail})`);
              }
            },
            onmessage: (message) => {
              if (message.setupComplete && !settled) {
                finish();
              }
              this.#onMessage(message);
            },
          },
        })
        .then((session) => {
          this.#session = session;
        })
        .catch((err) => {
          finish(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }

  appendMulaw8k(mulaw: Buffer): void {
    if (this.#closed || !this.#session) return;
    this.#userMulawBytesSinceEou += mulaw.length;
    const pcm8k = mulawToPcm16(mulaw);
    const pcm16k = upsample8kTo16k(pcm8k);
    this.#session.sendRealtimeInput({
      audio: {
        data: pcm16k.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  }

  createResponse(instructions?: string): boolean {
    if (!this.#session || this.#closed) return false;
    if (this.hasActiveResponse()) {
      this.#callbacks.onLog?.('createResponse skipped — response already active');
      return false;
    }
    this.#agentTranscriptBuf = '';
    this.#suppressOutput = false;
    this.#suppressUntil = 0;
    this.#bargeHold = false;
    this.#suppressEpoch += 1;
    this.#responsePending = true;
    const prompt =
      instructions?.trim() ||
      'Begin the conversation now with your opening line for this call.';
    this.#session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: prompt }] }],
      turnComplete: true,
    });
    return true;
  }

  cancelResponse(): void {
    if (!this.#suppressOutput && (this.#responseActive || this.#responsePending || !this.#bargeHold)) {
      this.#callbacks.onLog?.('Gemini Live barge-in — holding leftover audio until turn ends');
    }
    this.#bargeHold = true;
    this.#suppressOutput = true;
    this.#suppressEpoch += 1;
    // Keep suppress sticky; cleared only on turn/generation complete (not by timer).
    this.#suppressUntil = Date.now() + 120_000;
    this.#responsePending = false;
    this.#responseActive = false;
    this.#mulawRemainder = Buffer.alloc(0);
    this.#agentTranscriptBuf = '';
  }

  close(): void {
    this.#closed = true;
    void this.#session?.close();
    this.#session = null;
  }

  #emitMulawPcm(pcm24k: Buffer): void {
    if (this.#suppressOutput) return;
    const pcm8k = downsampleTo8k(pcm24k, OUTPUT_SAMPLE_RATE);
    const mulaw = Buffer.concat([this.#mulawRemainder, pcm16ToMulaw(pcm8k)]);
    this.#mulawRemainder = Buffer.alloc(0);

    let offset = 0;
    while (offset + MULAW_FRAME_BYTES <= mulaw.length) {
      if (this.#suppressOutput) {
        this.#mulawRemainder = Buffer.alloc(0);
        return;
      }
      this.#callbacks.onAudioMulaw?.(mulaw.subarray(offset, offset + MULAW_FRAME_BYTES));
      offset += MULAW_FRAME_BYTES;
    }
    if (offset < mulaw.length) {
      this.#mulawRemainder = mulaw.subarray(offset);
    }
  }

  async #handleToolCalls(
    functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
  ): Promise<void> {
    if (!this.#session || this.#closed || !functionCalls.length) return;
    const responses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];
    let forceSpeakLine = '';

    for (const call of functionCalls) {
      const name = call.name?.trim();
      if (!name) continue;
      this.#callbacks.onLog?.(`Gemini tool call: ${name}`, call.args);
      let result: unknown = { ok: false, error: 'No tool context' };
      if (this.#toolCtx) {
        try {
          result = await executeTelephonyTool(name, JSON.stringify(call.args ?? {}), this.#toolCtx);
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      } else if (name === 'end_call') {
        result = {
          ok: true,
          hangup: true,
          reason:
            typeof call.args?.reason === 'string' ? call.args.reason : 'agent_end_call',
          message: 'Call will end after goodbye.',
        };
      }

      const payload =
        result && typeof result === 'object' ? (result as Record<string, unknown>) : { ok: true, output: result };
      responses.push({
        id: call.id,
        name,
        response: shrinkToolPayload(payload, TelephonyGeminiLiveClient.MAX_TOOL_RESPONSE_CHARS),
      });

      if (
        name === 'lookup_hotel_availability' &&
        payload.fallback_to_brain !== true &&
        typeof payload.say === 'string' &&
        payload.say.trim() &&
        !forceSpeakLine
      ) {
        forceSpeakLine = payload.say.trim();
      }

      if (payload.hangup === true) {
        const reason =
          typeof payload.reason === 'string' && payload.reason.trim()
            ? payload.reason.trim()
            : 'end_call';
        console.log('[telephony] end_call tool', reason);
        this.#callbacks.onHangupRequested?.(reason);
      }
    }

    if (!responses.length || !this.#session || this.#closed) return;
    try {
      this.#session.sendToolResponse({ functionResponses: responses });
    } catch (err) {
      this.#callbacks.onError?.(
        `Failed to send tool response: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Nudge model once with exact rates — never stack on an in-flight turn (Live 500s).
    if (forceSpeakLine && this.#session && !this.#closed) {
      const line = forceSpeakLine;
      const session = this.#session;
      let deferAttempts = 0;
      const speak = () => {
        if (this.#closed || !this.#session || session !== this.#session) return;
        if (this.hasActiveResponse()) {
          deferAttempts += 1;
          if (deferAttempts > 40) {
            this.#callbacks.onLog?.('Gemini force-speak abandoned — response still active');
            return;
          }
          this.#callbacks.onLog?.('Gemini force-speak deferred — response active');
          setTimeout(speak, 120);
          return;
        }
        try {
          this.#responsePending = true;
          session.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      `SYSTEM: Speak the live rates to the caller NOW in one short line (use exactly):\n` +
                      `${line}\n` +
                      `Do not invent other prices. Do not say call later.`,
                  },
                ],
              },
            ],
            turnComplete: true,
          });
          this.#callbacks.onLog?.('Gemini force-speak hotel rates', { line: line.slice(0, 120) });
        } catch (err) {
          this.#responsePending = false;
          this.#callbacks.onError?.(
            `Hotel force-speak failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      setTimeout(speak, 180);
    }
  }

  /**
   * Commercial caller audio is held until Nexora returns one authorized action.
   * Partials only arm the hold. The final text is evaluated once.
   */
  #armCommercialGate(text: string, commit: boolean): void {
    const caller = text.trim();
    if (!caller) return;
    const watching = planDirectGeminiAudio({
      callerText: caller,
      authorityInjected: this.#authorityQueued,
      unguidedGenerationOpen: this.#holdCommercialAudio,
    });
    if (!watching.mustEvaluateBeforeSpeech) return;
    this.#holdCommercialAudio = true;
    if (!commit || this.#commercialCommitted) return;
    this.#commercialCommitted = true;
    void this.#injectCommercialAuthority(caller);
  }

  async #injectCommercialAuthority(text: string): Promise<void> {
    const callId = this.#toolCtx?.callId || 'gemini-audio';
    let instruction: string;
    try {
      if (this.#toolCtx?.negotiationPolicy !== undefined) {
        bindNegotiationPolicy(callId, this.#toolCtx.negotiationPolicy);
      }
      const result = await evaluateNegotiationForCall(callId, {
        utterance: text,
        eventId: `gate:${text.trim().toLowerCase()}`,
      });
      instruction = authoritySpeakInstruction(result.decision);
      this.#spokenAuthority = spokenAuthorityFromDecision(result.decision);
    } catch (err) {
      this.#callbacks.onLog?.(
        `Nexora negotiation failed closed: ${err instanceof Error ? err.message : String(err)}`,
      );
      const failed = negotiationFallback('direct audio gate failed');
      instruction = authoritySpeakInstruction(failed);
      this.#spokenAuthority = spokenAuthorityFromDecision(failed);
    }
    if (!this.#session || this.#closed) {
      this.#holdCommercialAudio = false;
      return;
    }
    try {
      this.#session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: instruction }] }],
        turnComplete: true,
      });
      this.#authorityQueued = true;
      if (this.#commercialReleaseTimer) clearTimeout(this.#commercialReleaseTimer);
      this.#commercialReleaseTimer = setTimeout(() => {
        if (this.#holdCommercialAudio && this.#authorityQueued) {
          this.#holdCommercialAudio = false;
          this.#authorityQueued = false;
        }
      }, 1600);
    } catch (err) {
      this.#holdCommercialAudio = false;
      this.#callbacks.onError?.(
        `Nexora authority inject failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  #onMessage(message: {
    setupComplete?: unknown;
    toolCall?: {
      functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
    };
    usageMetadata?: {
      promptTokenCount?: number;
      responseTokenCount?: number;
      totalTokenCount?: number;
      promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
      responseTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
    };
    serverContent?: {
      modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
      turnComplete?: boolean;
      generationComplete?: boolean;
      interrupted?: boolean;
      inputTranscription?: { text?: string; finished?: boolean };
      outputTranscription?: { text?: string; finished?: boolean };
    };
    voiceActivity?: { voiceActivityType?: VoiceActivityType };
  }): void {
    const activity = message.voiceActivity?.voiceActivityType;
    if (activity === VoiceActivityType.ACTIVITY_START) {
      // Close previous user row before a new utterance (ACTIVITY_END is flaky on phone).
      const pending = this.#userTranscriptBuf.trim();
      if (pending) this.#callbacks.onUserTranscript?.(pending, true);
      this.#userTranscriptBuf = '';
      this.#callerTurnText = '';
      this.#commercialCommitted = false;
      this.#spokenAuthority = null;
      this.#callbacks.onSpeechStarted?.();
    } else if (activity === VoiceActivityType.ACTIVITY_END) {
      const user = this.#userTranscriptBuf.trim() || this.#callerTurnText;
      if (user) this.#callbacks.onUserTranscript?.(user, true);
      this.#armCommercialGate(user, true);
      this.#userTranscriptBuf = '';
      this.#callbacks.onSpeechStopped?.();
    }

    if (message.toolCall?.functionCalls?.length) {
      void this.#handleToolCalls(message.toolCall.functionCalls);
    }

    if (message.usageMetadata) {
      const usage = message.usageMetadata;
      const detailCount = (
        details: Array<{ modality?: string; tokenCount?: number }> | undefined,
        modality: string,
      ) =>
        (details ?? [])
          .filter((d) => String(d.modality ?? '').toUpperCase().includes(modality))
          .reduce((sum, d) => sum + (d.tokenCount ?? 0), 0);
      this.#callbacks.onUsage?.({
        inputTextTokens: detailCount(usage.promptTokensDetails, 'TEXT'),
        inputAudioTokens: detailCount(usage.promptTokensDetails, 'AUDIO'),
        outputTextTokens: detailCount(usage.responseTokensDetails, 'TEXT'),
        outputAudioTokens: detailCount(usage.responseTokensDetails, 'AUDIO'),
        totalTokens: usage.totalTokenCount ?? 0,
      });
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.interrupted) {
      const decision = this.#callbacks.onInterrupted?.();
      if (decision === 'ignore') {
        // Keep any late opener audio; do not suppress or end the turn locally.
        this.#callbacks.onLog?.('Gemini Live interrupt ignored (opener protected)');
        return;
      }
      this.#bargeHold = true;
      this.#suppressOutput = true;
      this.#suppressEpoch += 1;
      this.#suppressUntil = Date.now() + 120_000;
      this.#mulawRemainder = Buffer.alloc(0);
      this.#responsePending = false;
      this.#responseActive = false;
      this.#callbacks.onResponseDone?.();
      const transcript = this.#agentTranscriptBuf.trim();
      if (transcript) this.#callbacks.onAgentTranscript?.(transcript, true);
      this.#agentTranscriptBuf = '';
      return;
    }

    const inputText = content.inputTranscription?.text?.trim();
    if (inputText) {
      this.#userTranscriptBuf = mergeTranscriptChunk(this.#userTranscriptBuf, inputText);
      this.#callerTurnText = this.#userTranscriptBuf;
      this.#armCommercialGate(this.#callerTurnText, false);
      // Keep partials open; finalize on ACTIVITY_* / agent response start / turnComplete.
      // (inputTranscription.finished is too phrase-level on Live, like agent output.)
      this.#callbacks.onUserTranscript?.(this.#userTranscriptBuf, false);
    }

    const outputText = content.outputTranscription?.text?.trim();
    if (outputText && !this.#bargeHold && !this.#holdCommercialAudio) {
      this.#agentTranscriptBuf = mergeTranscriptChunk(this.#agentTranscriptBuf, outputText);
      if (this.#spokenAuthority && commercialSpeechViolatesAuthority(this.#agentTranscriptBuf, this.#spokenAuthority)) {
        this.#suppressOutput = true;
        this.#agentTranscriptBuf = '';
        this.#callbacks.onLog?.('Dropped speech that exceeded Nexora authority');
      } else if (this.#agentTranscriptBuf.trim()) {
        // Never finalize on transcription.finished — Gemini sends per-phrase
        // finals ("Namaste, main" / "hoon?") which shatter the live transcript.
        this.#callbacks.onAgentTranscript?.(this.#agentTranscriptBuf, false);
      }
    }

    const parts = content.modelTurn?.parts ?? [];
    for (const part of parts) {
      const inlineData = part.inlineData;
      if (inlineData?.data) {
        // After local barge, drop the rest of THIS generation — do not reopen playback.
        if (this.#holdCommercialAudio && !this.#commercialCommitted) {
          this.#armCommercialGate(this.#callerTurnText || this.#userTranscriptBuf, true);
        }
        if (this.#bargeHold || this.#suppressOutput || this.#holdCommercialAudio) {
          continue;
        }
        if (!this.#responseActive) {
          this.#responsePending = false;
          this.#responseActive = true;
          // Seal the caller turn before the agent speaks — otherwise live UI
          // keeps one open Prospect row and folds the whole call into it.
          const pendingUser = this.#userTranscriptBuf.trim();
          if (pendingUser) {
            this.#callbacks.onUserTranscript?.(pendingUser, true);
            this.#userTranscriptBuf = '';
          }
          // Do not clear #agentTranscriptBuf here — outputTranscription often
          // arrives before the first audio chunk of the same turn.
          this.#callbacks.onResponseStarted?.();
        }
        this.#emitMulawPcm(Buffer.from(inlineData.data, 'base64'));
      } else if (part.text?.trim()) {
        if (this.#bargeHold) continue;
        this.#agentTranscriptBuf = mergeTranscriptChunk(this.#agentTranscriptBuf, part.text.trim());
        if (this.#agentTranscriptBuf.trim()) {
          this.#callbacks.onAgentTranscript?.(this.#agentTranscriptBuf.trim(), false);
        }
      }
    }

    if (content.generationComplete || content.turnComplete) {
      const pendingUser = this.#userTranscriptBuf.trim();
      if (pendingUser) {
        this.#callbacks.onUserTranscript?.(pendingUser, true);
        this.#armCommercialGate(pendingUser, true);
        this.#userTranscriptBuf = '';
      }
      if (this.#holdCommercialAudio && this.#authorityQueued) {
        this.#holdCommercialAudio = false;
        this.#authorityQueued = false;
        this.#agentTranscriptBuf = '';
        if (this.#commercialReleaseTimer) {
          clearTimeout(this.#commercialReleaseTimer);
          this.#commercialReleaseTimer = null;
        }
      }
      const transcript = this.#bargeHold || this.#holdCommercialAudio ? '' : this.#agentTranscriptBuf.trim();
      if (transcript) this.#callbacks.onAgentTranscript?.(transcript, true);
      this.#agentTranscriptBuf = '';
      this.#responsePending = false;
      this.#responseActive = false;
      this.#suppressOutput = false;
      this.#suppressUntil = 0;
      this.#bargeHold = false;
      this.#callbacks.onResponseDone?.();
    }
  }
}

/** Keep hotel tool payloads small — huge Nexora dumps crash Gemini Live mid-turn. */
function shrinkToolPayload(
  payload: Record<string, unknown>,
  maxChars: number,
): Record<string, unknown> {
  const raw = JSON.stringify(payload);
  if (raw.length <= maxChars) return payload;
  const say = typeof payload.say === 'string' ? payload.say.trim() : '';
  const ok = payload.ok;
  const fallback = payload.fallback_to_brain === true;
  const hint =
    typeof payload.hint === 'string'
      ? payload.hint
      : typeof payload.error === 'string'
        ? payload.error
        : 'Inventory details truncated — speak briefly from Product Knowledge.';
  const compact: Record<string, unknown> = {
    ok: ok !== false,
    truncated: true,
    hint: hint.slice(0, 280),
  };
  if (say) compact.say = say.slice(0, 500);
  if (fallback) compact.fallback_to_brain = true;
  if (typeof payload.city === 'string') compact.city = payload.city;
  if (typeof payload.hotel_name === 'string') compact.hotel_name = payload.hotel_name;
  return compact;
}

/** Gemini Live may send cumulative OR delta transcription chunks. */
function mergeTranscriptChunk(prev: string, next: string): string {
  const a = prev.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  if (b.startsWith(a)) return b;
  if (a.startsWith(b)) return a;
  if (a.includes(b) && b.length < a.length) return a;
  if (b.includes(a) && a.length < b.length) return b;
  // Delta fragment (e.g. "Namaste, main" then "aapse thodi der…")
  const gap = /[\s\u00a0]$/.test(a) || /^[\s\u00a0]/.test(b) ? '' : ' ';
  return `${a}${gap}${b}`;
}

export type TelephonyS2sClient = TelephonyGeminiLiveClient;
