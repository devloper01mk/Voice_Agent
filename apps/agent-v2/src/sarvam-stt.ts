import * as sarvam from '@livekit/agents-plugin-sarvam';
import {
  stt,
  asLanguageCode,
  type APIConnectOptions,
  type AudioBuffer,
  log,
} from '@livekit/agents';
import { SegmentFinalBuffer, resolveSegmentFinalDebounceMs } from './segment-final-buffer.js';

export function resolveSarvamApiKey(): string {
  const key = process.env.SARVAM_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'SARVAM_API_KEY is required for Sarvam STT — add it to the repo root .env and restart agent-v2 (npm run dev -w @vsa/agent-v2).',
    );
  }
  return key;
}

export function probeSarvamApiKey(): void {
  if (process.env.SARVAM_API_KEY?.trim()) {
    console.info('[vsa] Sarvam API key present — Sarvam STT ready');
    return;
  }
  console.warn(
    '[vsa] SARVAM_API_KEY not set — Simulator agents using Sarvam STT will fail until configured in .env',
  );
}

export interface BufferedSarvamSttOptions {
  apiKey?: string;
  model: string;
  mode: string;
  languageCode: string;
  segmentFinalMs?: number;
}

/** Sarvam STT with segment-final coalescing — avoids agent replying mid-sentence. */
export class BufferedSarvamSTT extends stt.STT {
  #inner: sarvam.STT;
  #segmentFinalMs: number;
  #model: string;

  constructor(opts: BufferedSarvamSttOptions) {
    super({ streaming: true, interimResults: true });
    this.#model = opts.model;
    this.#segmentFinalMs = opts.segmentFinalMs ?? resolveSegmentFinalDebounceMs();
    this.#inner = new sarvam.STT({
      apiKey: opts.apiKey ?? resolveSarvamApiKey(),
      model: opts.model as 'saaras:v3',
      mode: opts.mode as 'codemix' | 'transcribe' | 'translate' | 'verbatim' | 'translit',
      languageCode: opts.languageCode,
      highVadSensitivity: false,
      streaming: true,
    });
  }

  label = 'sarvam-buffered.STT';

  get model() {
    return this.#model;
  }

  get provider() {
    return 'Sarvam';
  }

  stream(options?: { connOptions?: APIConnectOptions }) {
    return new BufferedSarvamSpeechStream(
      this,
      this.#inner,
      this.#segmentFinalMs,
      options?.connOptions,
    );
  }

  protected async _recognize(buffer: AudioBuffer, abortSignal?: AbortSignal): Promise<stt.SpeechEvent> {
    return this.#inner.recognize(buffer, abortSignal);
  }
}

class BufferedSarvamSpeechStream extends stt.SpeechStream {
  #innerStt: sarvam.STT;
  #segmentFinalMs: number;
  #connOptions?: APIConnectOptions;
  #language = asLanguageCode('unknown');
  label = 'sarvam-buffered.SpeechStream';
  #logger = log();

  constructor(
    parent: BufferedSarvamSTT,
    innerStt: sarvam.STT,
    segmentFinalMs: number,
    connOptions?: APIConnectOptions,
  ) {
    super(parent, 16_000, connOptions);
    this.#innerStt = innerStt;
    this.#segmentFinalMs = segmentFinalMs;
    this.#connOptions = connOptions;
  }

  protected async run(): Promise<void> {
    const inner = this.#innerStt.stream({ connOptions: this.#connOptions });
    const buffer = new SegmentFinalBuffer(this.#segmentFinalMs, {
      onFinal: (text) => {
        this.queue.put({
          type: stt.SpeechEventType.FINAL_TRANSCRIPT,
          alternatives: [
            {
              text,
              language: this.#language,
              startTime: 0,
              endTime: 0,
              confidence: 1,
            },
          ],
        });
      },
      onInterim: (text) => {
        this.queue.put({
          type: stt.SpeechEventType.INTERIM_TRANSCRIPT,
          alternatives: [
            {
              text,
              language: this.#language,
              startTime: 0,
              endTime: 0,
              confidence: 1,
            },
          ],
        });
      },
    });

    const forwardInput = async () => {
      for await (const frame of this.input) {
        if (this.closed || this.input.closed) break;
        if (frame === stt.SpeechStream.FLUSH_SENTINEL) {
          inner.flush();
          continue;
        }
        inner.pushFrame(frame);
      }
    };

    const processOutput = async () => {
      try {
        for await (const event of inner) {
          if (this.closed) break;
          if (event.type === stt.SpeechEventType.START_OF_SPEECH) {
            this.queue.put(event);
          } else if (event.type === stt.SpeechEventType.END_OF_SPEECH) {
            buffer.ingest('', 'segment_end');
          } else if (event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
            const alt = event.alternatives?.[0];
            const text = alt?.text?.trim() ?? '';
            if (alt?.language) this.#language = alt.language;
            if (text) buffer.ingest(text, 'segment_end');
          } else if (event.type === stt.SpeechEventType.RECOGNITION_USAGE) {
            this.queue.put(event);
          }
        }
      } catch (err) {
        this.#logger.error({ err }, 'Buffered Sarvam STT stream failed');
        throw err;
      } finally {
        buffer.close();
      }
    };

    await Promise.all([forwardInput(), processOutput()]);
  }
}
