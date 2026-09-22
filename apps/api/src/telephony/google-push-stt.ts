import type { protos } from '@google-cloud/speech';
import { v2 } from '@google-cloud/speech';
import {
  buildGoogleRecognizerPath,
  googleSttLanguageCodes,
  resolveGoogleCloudProjectId,
  resolveGoogleSpeechLocation,
  resolveSttModel,
} from '@vsa/shared';
import type { TelephonySttOptions } from './azure-push-stt.js';
import {
  resolveSegmentFinalDebounceMs,
  SegmentFinalBuffer,
} from './segment-final-buffer.js';

const SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = Math.floor(SAMPLE_RATE / 20); // 50ms

export interface TelephonyGoogleSttConfig {
  model: string;
  languageCodes: string[];
  location: string;
  recognizer: string;
}

export function resolveTelephonyGoogleSttConfig(
  languages?: string,
  model?: string | null,
): TelephonyGoogleSttConfig {
  const projectId = resolveGoogleCloudProjectId();
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT (or GCP_PROJECT_ID) is not configured');
  }
  const location = resolveGoogleSpeechLocation();
  return {
    model: resolveSttModel('google', model),
    languageCodes: googleSttLanguageCodes(languages ?? ''),
    location,
    recognizer: buildGoogleRecognizerPath(projectId, location),
  };
}

/**
 * Streaming Google Cloud Speech v2 STT for phone calls (16 kHz PCM push).
 */
export class TelephonyGooglePushStt {
  #client: v2.SpeechClient | null = null;
  #stream: ReturnType<v2.SpeechClient['_streamingRecognize']> | null = null;
  #closed = false;
  #started = false;
  #opts: TelephonySttOptions;
  #config: TelephonyGoogleSttConfig;
  #pcmRemainder = Buffer.alloc(0);
  #speaking = false;
  #segmentBuffer: SegmentFinalBuffer;

  constructor(opts: TelephonySttOptions, model?: string | null) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not configured');
    }
    this.#opts = opts;
    this.#config = resolveTelephonyGoogleSttConfig(opts.languages, model);
    this.#segmentBuffer = new SegmentFinalBuffer(resolveSegmentFinalDebounceMs(), {
      onFinal: (text) => this.#opts.onFinal(text),
      onInterim: (text) => this.#opts.onInterim?.(text),
    });
  }

  get ready(): boolean {
    return this.#started && !this.#closed && this.#stream != null;
  }

  get locale(): string {
    return `${this.#config.languageCodes.join('+')} (${this.#config.model} @ ${this.#config.location})`;
  }

  adoptHandlers(opts: TelephonySttOptions): void {
    this.#opts = opts;
    if (this.#started) this.#opts.onReady?.();
  }

  async start(): Promise<void> {
    if (this.#closed || this.#started) return;

    const client = new v2.SpeechClient({
      apiEndpoint: `${this.#config.location}-speech.googleapis.com`,
    });
    this.#client = client;

    const stream = client._streamingRecognize();
    this.#stream = stream;

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
        finish(new Error('Google STT streaming open timeout'));
      }, 12_000);

      stream.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!settled) finish(err instanceof Error ? err : new Error(message));
        else if (!this.#closed) this.#opts.onError?.(message);
      });

      stream.on('data', (response) => this.#onResponse(response));

      try {
        stream.write({
          recognizer: this.#config.recognizer,
          streamingConfig: {
            config: {
              model: this.#config.model,
              languageCodes: this.#config.languageCodes,
              explicitDecodingConfig: {
                encoding: 'LINEAR16',
                sampleRateHertz: SAMPLE_RATE,
                audioChannelCount: 1,
              },
            },
            streamingFeatures: {
              interimResults: true,
              enableVoiceActivityEvents: true,
            },
          },
        });
        finish();
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.#started = true;
    this.#opts.onReady?.();
  }

  pushPcm16_16k(pcm: Buffer): void {
    if (!this.ready || !this.#stream) return;
    const merged = Buffer.concat([this.#pcmRemainder, pcm]);
    const bytesPerChunk = CHUNK_SAMPLES * 2;
    let offset = 0;
    while (offset + bytesPerChunk <= merged.length) {
      const chunk = merged.subarray(offset, offset + bytesPerChunk);
      try {
        this.#stream.write({ audio: chunk });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.#opts.onError?.(message);
        return;
      }
      offset += bytesPerChunk;
    }
    this.#pcmRemainder = offset < merged.length ? merged.subarray(offset) : Buffer.alloc(0);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#started = false;
    this.#segmentBuffer.close();
    const stream = this.#stream;
    this.#stream = null;
    const client = this.#client;
    this.#client = null;
    if (stream) {
      await new Promise<void>((resolve) => {
        stream.end();
        stream.on('end', () => resolve());
        stream.on('close', () => resolve());
        setTimeout(resolve, 500);
      });
    }
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }

  #onResponse(response: protos.google.cloud.speech.v2.IStreamingRecognizeResponse): void {
    const eventType = String(response.speechEventType ?? '');
    if (eventType === 'SPEECH_ACTIVITY_BEGIN' && !this.#speaking) {
      this.#speaking = true;
    }
    if (eventType === 'SPEECH_ACTIVITY_END' && this.#speaking) {
      this.#speaking = false;
    }

    const results = response.results ?? [];
    for (const result of results) {
      const transcript = String(result.alternatives?.[0]?.transcript ?? '').trim();
      if (!transcript) continue;
      if (result.isFinal) {
        this.#segmentBuffer.ingest(transcript, 'segment_end');
        this.#speaking = false;
      } else {
        this.#segmentBuffer.ingest(transcript, 'interim');
      }
    }

    if (eventType === 'SPEECH_ACTIVITY_END' && results.length === 0) {
      this.#opts.onNoMatch?.();
    }
  }
}
