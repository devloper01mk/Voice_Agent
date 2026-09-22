import { v2 } from '@google-cloud/speech';
import {
  APIError,
  AudioByteStream,
  asLanguageCode,
  log,
  stt,
  waitForAbort,
  type APIConnectOptions,
} from '@livekit/agents';
import {
  buildGoogleRecognizerPath,
  googleSttLanguageCodes,
  resolveGoogleCloudProjectId,
  resolveGoogleSpeechLocation,
  resolveSttModel,
  type SpeakLanguage,
} from '@vsa/shared';

export interface GoogleSTTOptions {
  projectId?: string;
  location?: string;
  model?: string;
  languages?: SpeakLanguage[];
  sampleRate?: number;
  onError?: (message: string) => void;
}

const DEFAULT_OPTS = {
  sampleRate: 16000,
};

type GoogleSTTRuntimeOpts = typeof DEFAULT_OPTS & {
  projectId: string;
  location: string;
  model: string;
  languageCodes: string[];
  recognizer: string;
  onError?: (message: string) => void;
};

type GoogleStreamingResponse =
  import('@google-cloud/speech').protos.google.cloud.speech.v2.IStreamingRecognizeResponse;

export class GoogleSTT extends stt.STT {
  #opts: GoogleSTTRuntimeOpts;

  constructor(opts: GoogleSTTOptions = {}) {
    super({ streaming: true, interimResults: true });
    const projectId = resolveGoogleCloudProjectId(opts.projectId);
    if (!projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT (or GCP_PROJECT_ID) is required for Google STT');
    }
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS is required for Google STT');
    }
    const location = resolveGoogleSpeechLocation(opts.location);
    const languages = opts.languages ?? ['en', 'hi', 'hinglish'];
    this.#opts = {
      ...DEFAULT_OPTS,
      projectId,
      location,
      model: resolveSttModel('google', opts.model),
      languageCodes: googleSttLanguageCodes(languages),
      recognizer: buildGoogleRecognizerPath(projectId, location),
      sampleRate: opts.sampleRate ?? DEFAULT_OPTS.sampleRate,
      onError: opts.onError,
    };
  }

  get label() {
    return 'google.STT';
  }

  get model() {
    return this.#opts.model;
  }

  get provider() {
    return 'Google';
  }

  protected async _recognize(): Promise<stt.SpeechEvent> {
    throw new Error('Google STT only supports streaming via stream()');
  }

  stream(options?: { connOptions?: APIConnectOptions }) {
    return new GoogleSpeechStream(this, this.#opts, options?.connOptions);
  }
}

class GoogleSpeechStream extends stt.SpeechStream {
  #opts: GoogleSTTRuntimeOpts;
  #logger = log();
  #speaking = false;
  #detectedLocale = 'en-IN';

  constructor(
    sttInstance: GoogleSTT,
    opts: GoogleSTTRuntimeOpts,
    connOptions?: APIConnectOptions,
  ) {
    super(sttInstance, opts.sampleRate, connOptions);
    this.#opts = opts;
    this.#detectedLocale = opts.languageCodes[0] ?? 'en-IN';
  }

  get label() {
    return 'google.SpeechStream';
  }

  protected async run(): Promise<void> {
    const client = new v2.SpeechClient({
      apiEndpoint: `${this.#opts.location}-speech.googleapis.com`,
    });

    const googleStream = client._streamingRecognize();
    const abortController = new AbortController();
    let fatalError: APIError | undefined;

    const onData = (response: GoogleStreamingResponse) => {
      this.#handleResponse(response);
    };

    const onError = (err: Error) => {
      const message = err.message || String(err);
      this.#logger.error({ err: message }, 'Google STT stream error');
      this.#opts.onError?.(message);
      fatalError = new APIError(message, { retryable: true });
      abortController.abort();
    };

    googleStream.on('data', onData);
    googleStream.on('error', onError);

    try {
      googleStream.write({
        recognizer: this.#opts.recognizer,
        streamingConfig: {
          config: {
            model: this.#opts.model,
            languageCodes: this.#opts.languageCodes,
            explicitDecodingConfig: {
              encoding: 'LINEAR16',
              sampleRateHertz: this.#opts.sampleRate,
              audioChannelCount: 1,
            },
          },
          streamingFeatures: {
            interimResults: true,
            enableVoiceActivityEvents: true,
          },
        },
      });

      await this.#sendAudio(googleStream, abortController.signal);
    } finally {
      googleStream.removeListener('data', onData);
      googleStream.removeListener('error', onError);
      await new Promise<void>((resolve) => {
        googleStream.end();
        googleStream.on('end', () => resolve());
        googleStream.on('close', () => resolve());
        setTimeout(resolve, 500);
      });
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }

    if (fatalError) throw fatalError;
    this.close();
  }

  #handleResponse(response: GoogleStreamingResponse): void {
    const eventType = String(response.speechEventType ?? '');
    if (eventType === 'SPEECH_ACTIVITY_BEGIN' && !this.#speaking) {
      this.#speaking = true;
      if (!this.queue.closed) {
        this.queue.put({
          type: stt.SpeechEventType.START_OF_SPEECH,
          alternatives: [
            {
              language: asLanguageCode(this.#detectedLocale),
              text: '',
              startTime: 0,
              endTime: 0,
              confidence: 0,
            },
          ],
        });
      }
    }

    const results = response.results ?? [];
    for (const result of results) {
      const transcript = String(result.alternatives?.[0]?.transcript ?? '').trim();
      if (!transcript) continue;
      if (result.languageCode) {
        this.#detectedLocale = result.languageCode;
      }
      const confidence = result.alternatives?.[0]?.confidence ?? 0;
      if (result.isFinal) {
        this.#emitTranscript(stt.SpeechEventType.FINAL_TRANSCRIPT, transcript, confidence);
        if (this.#speaking && !this.queue.closed) {
          this.#speaking = false;
          this.queue.put({
            type: stt.SpeechEventType.END_OF_SPEECH,
            alternatives: [
              {
                language: asLanguageCode(this.#detectedLocale),
                text: transcript,
                startTime: 0,
                endTime: 0,
                confidence,
              },
            ],
          });
        }
      } else {
        this.#emitTranscript(stt.SpeechEventType.INTERIM_TRANSCRIPT, transcript, confidence);
      }
    }

    if (eventType === 'SPEECH_ACTIVITY_END' && this.#speaking && !this.queue.closed) {
      this.#speaking = false;
      this.queue.put({
        type: stt.SpeechEventType.END_OF_SPEECH,
        alternatives: [
          {
            language: asLanguageCode(this.#detectedLocale),
            text: '',
            startTime: 0,
            endTime: 0,
            confidence: 0,
          },
        ],
      });
    }
  }

  #emitTranscript(type: stt.SpeechEventType, text: string, confidence = 0): void {
    if (this.queue.closed) return;
    this.queue.put({
      type,
      alternatives: [
        {
          language: asLanguageCode(this.#detectedLocale),
          text,
          startTime: 0,
          endTime: 0,
          confidence,
        },
      ],
    });
  }

  async #sendAudio(
    googleStream: ReturnType<v2.SpeechClient['_streamingRecognize']>,
    abortSignal: AbortSignal,
  ): Promise<void> {
    const audioBstream = new AudioByteStream(this.#opts.sampleRate, 1, 1600);
    const iterator = this.input[Symbol.asyncIterator]();
    const abortPromise = waitForAbort(abortSignal);

    while (true) {
      const result = await Promise.race([iterator.next(), abortPromise]);
      if (result === undefined) return;
      if (result.done) break;

      const data = result.value;
      const frames =
        data === stt.SpeechStream.FLUSH_SENTINEL
          ? audioBstream.flush()
          : audioBstream.write(data.data);

      for (const frame of frames) {
        googleStream.write({ audio: Buffer.from(frame.data) });
      }
    }
  }
}
