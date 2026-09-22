import WebSocket from 'ws';
import {
  resolveSttModel,
  sarvamSttLanguageCode,
  sarvamSttMode,
} from '@vsa/shared';
import type { TelephonySttOptions } from './azure-push-stt.js';
import {
  resolveSegmentFinalDebounceMs,
  SegmentFinalBuffer,
} from './segment-final-buffer.js';

const SAMPLE_RATE = 16_000;
const SARVAM_STT_WS_URL = 'wss://api.sarvam.ai/speech-to-text/ws';
const CHUNK_SAMPLES = Math.floor(SAMPLE_RATE / 20); // 50ms

export interface TelephonySarvamSttConfig {
  model: string;
  mode: string;
  languageCode: string;
}

export function resolveTelephonySarvamSttConfig(
  languages?: string,
  model?: string | null,
): TelephonySarvamSttConfig {
  return {
    model: resolveSttModel('sarvam', model),
    mode: sarvamSttMode(languages ?? ''),
    languageCode: sarvamSttLanguageCode(languages ?? ''),
  };
}

function buildWsUrl(config: TelephonySarvamSttConfig): string {
  const params = new URLSearchParams();
  params.set('model', config.model);
  params.set('mode', config.mode);
  params.set('language-code', config.languageCode);
  params.set('vad_signals', 'true');
  params.set('sample_rate', String(SAMPLE_RATE));
  params.set('input_audio_codec', 'pcm_s16le');
  // Lower sensitivity — high=true ends phrases on brief pauses between sentences.
  params.set('high_vad_sensitivity', 'false');
  return `${SARVAM_STT_WS_URL}?${params.toString()}`;
}

/**
 * Streaming Sarvam Saaras STT for phone calls (16 kHz PCM push).
 */
export class TelephonySarvamPushStt {
  #ws: WebSocket | null = null;
  #closed = false;
  #started = false;
  #opts: TelephonySttOptions;
  #config: TelephonySarvamSttConfig;
  #lastTranscript = '';
  #pcmRemainder = Buffer.alloc(0);
  #segmentBuffer: SegmentFinalBuffer;

  constructor(opts: TelephonySttOptions, model?: string | null) {
    const apiKey = process.env.SARVAM_API_KEY?.trim();
    if (!apiKey) throw new Error('SARVAM_API_KEY is not configured');
    this.#opts = opts;
    this.#config = resolveTelephonySarvamSttConfig(opts.languages, model);
    this.#segmentBuffer = new SegmentFinalBuffer(resolveSegmentFinalDebounceMs(), {
      onFinal: (text) => this.#opts.onFinal(text),
      onInterim: (text) => this.#opts.onInterim?.(text),
    });
  }

  get ready(): boolean {
    return this.#started && !this.#closed && this.#ws?.readyState === WebSocket.OPEN;
  }

  get locale(): string {
    return `${this.#config.languageCode} (${this.#config.mode})`;
  }

  adoptHandlers(opts: TelephonySttOptions): void {
    this.#opts = opts;
    if (this.#started) this.#opts.onReady?.();
  }

  async start(): Promise<void> {
    if (this.#closed || this.#started) return;
    const apiKey = process.env.SARVAM_API_KEY!.trim();
    const url = buildWsUrl(this.#config);

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
        finish(new Error('Sarvam STT WebSocket open timeout'));
      }, 12_000);

      const ws = new WebSocket(url, {
        headers: { 'api-subscription-key': apiKey },
      });
      this.#ws = ws;

      ws.on('open', () => finish());
      ws.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
      ws.on('message', (data) => this.#onMessage(data.toString()));
      ws.on('close', (code, reason) => {
        if (!settled) {
          finish(new Error(`Sarvam STT closed before ready (${code}: ${reason?.toString() || ''})`));
          return;
        }
        if (!this.#closed) {
          this.#started = false;
          this.#opts.onError?.(`Sarvam STT WebSocket closed (${code})`);
        }
      });
    });

    this.#started = true;
    this.#opts.onReady?.();
  }

  pushPcm16_16k(pcm: Buffer): void {
    if (!this.ready || !this.#ws) return;
    const merged = Buffer.concat([this.#pcmRemainder, pcm]);
    const bytesPerChunk = CHUNK_SAMPLES * 2;
    let offset = 0;
    while (offset + bytesPerChunk <= merged.length) {
      const chunk = merged.subarray(offset, offset + bytesPerChunk);
      this.#ws.send(
        JSON.stringify({
          audio: {
            data: chunk.toString('base64'),
            encoding: 'audio/wav',
            sample_rate: SAMPLE_RATE,
          },
        }),
      );
      offset += bytesPerChunk;
    }
    this.#pcmRemainder = offset < merged.length ? merged.subarray(offset) : Buffer.alloc(0);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#started = false;
    this.#segmentBuffer.close();
    const ws = this.#ws;
    this.#ws = null;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          type: 'end_of_stream',
          audio: { data: '', encoding: 'audio/wav', sample_rate: SAMPLE_RATE },
        }),
      );
    } catch {
      /* ignore */
    }
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
      setTimeout(resolve, 500);
    });
  }

  #onMessage(raw: string): void {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(json.type ?? '');

    if (type === 'events') {
      const eventData = (json.data ?? {}) as { signal_type?: string };
      if (eventData.signal_type === 'END_SPEECH') {
        const text = this.#lastTranscript.trim();
        if (text) {
          this.#segmentBuffer.ingest(text, 'segment_end');
        } else {
          this.#opts.onNoMatch?.();
        }
        this.#lastTranscript = '';
        try {
          this.#ws?.send(JSON.stringify({ type: 'flush' }));
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (type === 'data') {
      const td = (json.data ?? {}) as { transcript?: string };
      const transcript = String(td.transcript ?? '').trim();
      if (!transcript) return;
      this.#lastTranscript = transcript;
      this.#segmentBuffer.ingest(transcript, 'interim');
      return;
    }

    if (type === 'error') {
      const nested = (json.data ?? {}) as { message?: string; error?: string };
      const message =
        nested.message ??
        nested.error ??
        String(json.message ?? json.error ?? 'Sarvam STT error');
      this.#opts.onError?.(message);
    }
  }
}
