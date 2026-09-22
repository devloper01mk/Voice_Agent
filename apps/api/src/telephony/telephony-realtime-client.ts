import WebSocket from 'ws';
import {
  REALTIME_S2S_TRANSCRIPTION_PROMPT,
  normalizeRealtimeS2sUserConfig,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';
import { downsampleTo8k, mulawToPcm16, pcm16ToMulaw, upsample8kTo24k } from './mulaw.js';

const SAMPLE_RATE = 24000;
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const MULAW_FRAME_BYTES = 160;

export type TelephonyRealtimeCallbacks = {
  onAudioMulaw?: (frame: Buffer) => void;
  onUserTranscript?: (text: string, final: boolean) => void;
  onAgentTranscript?: (text: string, final: boolean) => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
  onResponseStarted?: () => void;
  onResponseDone?: () => void;
  onInterrupted?: () => void;
  onHangupRequested?: (reason: string) => void;
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

export class TelephonyRealtimeClient {
  #ws: WebSocket | null = null;
  #closed = false;
  #callbacks: TelephonyRealtimeCallbacks;
  #config: RealtimeS2sUserConfig;
  #instructions: string;
  #agentTranscriptBuf = '';
  #userTranscriptBuf = '';
  #mulawRemainder = Buffer.alloc(0);
  #autoRespond: boolean;
  #responseActive = false;
  #responsePending = false;
  /** Drop model audio after local barge-in until the next response starts. */
  #suppressOutput = false;

  constructor(opts: {
    config: Partial<RealtimeS2sUserConfig>;
    instructions: string;
    /** When false, server VAD will not auto-create replies (use for outbound opener). */
    autoRespond?: boolean;
    callbacks: TelephonyRealtimeCallbacks;
  }) {
    this.#config = normalizeRealtimeS2sUserConfig(opts.config);
    this.#instructions = opts.instructions;
    this.#autoRespond = opts.autoRespond !== false;
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
    this.#sendSessionUpdate();
  }

  async connect(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for telephony S2S');

    const url = `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(this.#config.model)}`;

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
        finish(new Error('Realtime session.created timeout'));
      }, 15_000);

      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      this.#ws = ws;

      ws.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
      ws.on('message', (data) => {
        this.#onMessage(data.toString(), () => finish());
      });
      ws.on('close', (code, reason) => {
        if (!settled) {
          const detail = reason?.toString() || `code ${code}`;
          finish(new Error(`Realtime WebSocket closed before session (${detail})`));
        } else if (!this.#closed) {
          const detail = reason?.toString() || `code ${code}`;
          this.#callbacks.onError?.(`Realtime WebSocket closed (${detail})`);
        }
      });
    });
  }

  #buildTurnDetection() {
    const cfg = this.#config;
    const base =
      cfg.turnDetectionMode === 'semantic'
        ? {
            type: 'semantic_vad' as const,
            eagerness: cfg.turnDetectionEagerness,
          }
        : {
            type: 'server_vad' as const,
            threshold: cfg.turnDetectionThreshold,
            prefix_padding_ms: cfg.turnDetectionPrefixPaddingMs,
            silence_duration_ms: cfg.turnDetectionSilenceDurationMs,
          };
    return {
      ...base,
      create_response: this.#autoRespond,
      interrupt_response: true,
    };
  }

  #sendSessionUpdate(): void {
    const cfg = this.#config;
    const maxOutputTokens = cfg.maxTokensMode === 'custom' ? cfg.maxTokensCustom : 'inf';
    const noiseReduction =
      cfg.noiseReduction !== 'off' ? { type: cfg.noiseReduction } : undefined;

    this.#send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: cfg.model,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            noise_reduction: noiseReduction,
            transcription: {
              model: cfg.transcriptionModel,
              prompt: REALTIME_S2S_TRANSCRIPTION_PROMPT,
            },
            turn_detection: this.#buildTurnDetection(),
          },
          output: {
            format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            voice: cfg.voice,
          },
        },
        max_output_tokens: maxOutputTokens,
        instructions: this.#instructions,
      },
    });
  }

  appendMulaw8k(mulaw: Buffer): void {
    if (this.#closed || !this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    const pcm8k = mulawToPcm16(mulaw);
    const pcm24k = upsample8kTo24k(pcm8k);
    this.#send({
      type: 'input_audio_buffer.append',
      audio: pcm24k.toString('base64'),
    });
  }

  /** OpenAI realtime commits via server VAD; no-op for API parity with Gemini. */
  signalAudioStreamEnd(): void {}

  createResponse(instructions?: string): boolean {
    if (this.hasActiveResponse()) {
      this.#callbacks.onLog?.('createResponse skipped — response already active');
      return false;
    }
    this.#agentTranscriptBuf = '';
    this.#suppressOutput = false;
    this.#responsePending = true;
    this.#send({
      type: 'response.create',
      response: instructions ? { instructions } : undefined,
    });
    return true;
  }

  cancelResponse(): void {
    this.#suppressOutput = true;
    this.#mulawRemainder = Buffer.alloc(0);
    this.#responsePending = false;
    this.#responseActive = false;
    this.#send({ type: 'response.cancel' });
  }

  close(): void {
    this.#closed = true;
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.close(1000, 'telephony-end');
    }
    this.#ws = null;
  }

  #send(obj: Record<string, unknown>): void {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(obj));
    }
  }

  #emitMulawPcm(pcm24k: Buffer): void {
    if (this.#suppressOutput) return;
    const pcm8k = downsampleTo8k(pcm24k, SAMPLE_RATE);
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

  #onMessage(raw: string, onSessionReady?: () => void): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(event.type ?? '');

    switch (type) {
      case 'error': {
        const err = event.error as { message?: string; code?: string } | undefined;
        const message = err?.message ?? 'Realtime API error';
        if (/cancellation failed/i.test(message) || /no active response/i.test(message)) {
          this.#callbacks.onLog?.(message);
          break;
        }
        if (/already has an active response/i.test(message)) {
          this.#responsePending = false;
          this.#responseActive = true;
          this.#callbacks.onLog?.(message);
          break;
        }
        this.#callbacks.onError?.(message);
        break;
      }
      case 'response.created':
        this.#suppressOutput = false;
        this.#responsePending = false;
        this.#responseActive = true;
        this.#agentTranscriptBuf = '';
        this.#callbacks.onResponseStarted?.();
        break;
      case 'session.created':
        this.#sendSessionUpdate();
        onSessionReady?.();
        break;
      case 'session.updated':
        this.#callbacks.onLog?.(`Realtime ${type}`, { voice: this.#config.voice });
        break;
      case 'input_audio_buffer.speech_started':
        this.#userTranscriptBuf = '';
        this.#callbacks.onSpeechStarted?.();
        break;
      case 'input_audio_buffer.speech_stopped':
        this.#callbacks.onSpeechStopped?.();
        break;
      case 'conversation.item.input_audio_transcription.delta': {
        const delta = String((event as { delta?: string }).delta ?? '');
        if (!delta) break;
        this.#userTranscriptBuf += delta;
        const text = this.#userTranscriptBuf.trim();
        if (text) this.#callbacks.onUserTranscript?.(text, false);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = String(
          (event as { transcript?: string }).transcript ?? this.#userTranscriptBuf,
        ).trim();
        this.#userTranscriptBuf = transcript;
        if (transcript) this.#callbacks.onUserTranscript?.(transcript, true);
        break;
      }
      case 'response.output_audio.delta':
      case 'response.audio.delta': {
        const delta = (event as { delta?: string }).delta;
        if (!delta) break;
        this.#emitMulawPcm(Buffer.from(delta, 'base64'));
        break;
      }
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': {
        const delta = String((event as { delta?: string }).delta ?? '');
        this.#agentTranscriptBuf += delta;
        if (this.#agentTranscriptBuf.trim()) {
          this.#callbacks.onAgentTranscript?.(this.#agentTranscriptBuf, false);
        }
        break;
      }
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const transcript = String(
          (event as { transcript?: string }).transcript ?? this.#agentTranscriptBuf,
        ).trim();
        this.#agentTranscriptBuf = transcript;
        if (transcript) this.#callbacks.onAgentTranscript?.(transcript, true);
        break;
      }
      case 'response.done': {
        const wasSuppressed = this.#suppressOutput;
        this.#responsePending = false;
        this.#responseActive = false;
        const response = (event as {
          response?: {
            status?: string;
            usage?: {
              total_tokens?: number;
              input_token_details?: { text_tokens?: number; audio_tokens?: number };
              output_token_details?: { text_tokens?: number; audio_tokens?: number };
            };
          };
        }).response;
        if (wasSuppressed || response?.status === 'cancelled') {
          this.#callbacks.onInterrupted?.();
        }
        const usage = response?.usage;
        if (usage) {
          this.#callbacks.onUsage?.({
            inputTextTokens: usage.input_token_details?.text_tokens ?? 0,
            inputAudioTokens: usage.input_token_details?.audio_tokens ?? 0,
            outputTextTokens: usage.output_token_details?.text_tokens ?? 0,
            outputAudioTokens: usage.output_token_details?.audio_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          });
        }
        this.#suppressOutput = false;
        this.#callbacks.onResponseDone?.();
        break;
      }
      default:
        break;
    }
  }
}
