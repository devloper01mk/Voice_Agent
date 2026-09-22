import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import {
  APIError,
  type APIConnectOptions,
  AudioByteStream,
  asLanguageCode,
  delay,
  log,
  stt,
  waitForAbort,
} from '@livekit/agents';
import { type SpeakLanguage, parseVoiceLanguages } from '@vsa/shared';

export interface AzureSTTOptions {
  speechKey?: string;
  speechRegion?: string;
  language?: string;
  languages?: SpeakLanguage[];
  sampleRate?: number;
  /** Minimum words in a final transcript before it is accepted (filters background blurts). */
  minFinalWords?: number;
  /** Drop finals below this confidence when detailed results are available. */
  minFinalConfidence?: number;
  /** Azure end-of-segment silence timeout in milliseconds. */
  silenceTimeoutMs?: number;
  /** Boost recognition for product/company terms. */
  phraseList?: string[];
  /** Called when a final transcript is rejected due to low confidence. */
  onUnclearSpeech?: (details: { text: string; confidence: number }) => void;
  /** Called when Azure STT reports a cancellation or recognition error. */
  onError?: (message: string) => void;
}

const DEFAULT_OPTS = {
  speechKey: '',
  speechRegion: 'centralindia',
  language: 'en-IN',
  languages: ['en', 'hi', 'hinglish'] as SpeakLanguage[],
  sampleRate: 16000,
  minFinalWords: 2,
  minFinalConfidence: 0.4,
  silenceTimeoutMs: 500,
};

type AzureSTTRuntimeOpts = typeof DEFAULT_OPTS & {
  speechKey: string;
  phraseList: string[];
  onUnclearSpeech?: (details: { text: string; confidence: number }) => void;
  onError?: (message: string) => void;
};

/** Map Azure cancel details to a user-facing message (quota / bad key are common listen blockers). */
export function formatAzureSttErrorMessage(
  errorDetails: string | undefined,
  errorCode: number,
  speechRegion: string,
): string {
  const raw = errorDetails || `Azure STT error (code ${errorCode})`;
  if (/quota exceeded/i.test(raw)) {
    return (
      `Azure Speech quota exceeded — check Speech resource tier/billing in Azure Portal ` +
      `(region ${speechRegion}). Agent cannot hear until quota is restored.`
    );
  }
  if (/401|403|access denied|invalid.*subscription.?key|unauthorized/i.test(raw)) {
    return (
      `Azure Speech key rejected — update AZURE_SPEECH_KEY / region ${speechRegion} in .env. ` +
      `Agent cannot hear until the key is valid.`
    );
  }
  return raw;
}

const START_RECOGNITION_TIMEOUT_MS = 8_000;

/**
 * Fast auth check against Azure STS. Invalid keys often make the realtime SDK hang
 * instead of canceling — so we probe at boot and fail connect with a clear error.
 */
export async function probeAzureSpeechKey(opts?: {
  speechKey?: string;
  speechRegion?: string;
}): Promise<void> {
  const speechKey = opts?.speechKey ?? process.env.AZURE_SPEECH_KEY ?? '';
  const speechRegion = opts?.speechRegion ?? process.env.AZURE_SPEECH_REGION ?? 'centralindia';
  if (!speechKey) {
    throw new Error('AZURE_SPEECH_KEY is required for Azure STT');
  }
  const res = await fetch(
    `https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': speechKey,
        'Content-Length': '0',
      },
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Azure Speech key rejected (${res.status}) for region ${speechRegion}. ` +
        `Agent cannot hear until AZURE_SPEECH_KEY is fixed in .env.`,
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Azure Speech token probe failed (${res.status}): ${text}`);
  }
}

function startContinuousRecognition(recognizer: sdk.SpeechRecognizer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new APIError(
          `Azure STT failed to connect within ${START_RECOGNITION_TIMEOUT_MS}ms — ` +
            `check AZURE_SPEECH_KEY / region / billing (invalid keys often hang instead of erroring).`,
          { retryable: true },
        ),
      );
    }, START_RECOGNITION_TIMEOUT_MS);
    recognizer.startContinuousRecognitionAsync(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function toAzureLocales(languages: SpeakLanguage[]): string[] {
  const locales = new Set<string>();
  for (const lang of languages) {
    if (lang === 'en' || lang === 'hinglish') locales.add('en-IN');
    if (lang === 'hi' || lang === 'hinglish') locales.add('hi-IN');
  }
  return locales.size ? [...locales] : ['en-IN', 'hi-IN'];
}

function createSpeechConfig(
  speechKey: string,
  speechRegion: string,
  locales: string[],
  silenceTimeoutMs: number,
): sdk.SpeechConfig {
  let speechConfig: sdk.SpeechConfig;

  if (locales.length > 1) {
    // Continuous language ID requires the universal v2 STT endpoint.
    const endpoint = `wss://${speechRegion}.stt.speech.microsoft.com/speech/universal/v2`;
    speechConfig = sdk.SpeechConfig.fromEndpoint(new URL(endpoint), speechKey);
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
      'Continuous',
    );
  } else {
    speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
    speechConfig.speechRecognitionLanguage = locales[0]!;
  }

  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    String(silenceTimeoutMs),
  );
  speechConfig.setProperty(
    sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
    String(silenceTimeoutMs),
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceResponse_RequestDetailedResultTrueFalse,
    'true',
  );

  return speechConfig;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Short yes/no and single letters — needed for phone confirm. */
const SHORT_CONFIRM_RE =
  /^(ji+|haan+|han+|ha+|yes|yeah|yep|ok|okay|no|nahi+|nah+|galat|sahi|wrong|correct|theek|bilkul)$/i;
const SINGLE_LETTER_RE = /^[a-z]$/i;
const SPELLING_FINAL_RE =
  /^(?:(?:double|triple)\s+(?:[a-z]|ay|bee|see|dee|ee|eff|gee|aitch|eye|jay|kay|ell|em|en|oh|pee|cue|are|ess|tee|you|vee|ex|why|zee|zed)|double|triple|dot|period|underscore|dash|hyphen|plus)$/i;
/** Inbound openers — single word, must not be dropped by minFinalWords=2. */
const GREETING_ACCEPT_RE =
  /^(hello+|hi+|hey+|hola|namaste|namaskar|good\s*(morning|evening|afternoon)|हैलो|हेलो|नमस्ते|नमस्कार)[\s.?!]*$/iu;

function shouldAcceptFinal(
  text: string,
  confidence: number,
  minWords: number,
  minConfidence: number,
): boolean {
  const trimmed = text.trim();
  const words = countWords(text);
  if (SHORT_CONFIRM_RE.test(trimmed) && confidence >= Math.max(0.5, minConfidence - 0.15)) {
    return true;
  }
  if (GREETING_ACCEPT_RE.test(trimmed) && confidence >= Math.max(0.45, minConfidence - 0.2)) {
    return true;
  }
  if (SINGLE_LETTER_RE.test(trimmed) && confidence >= Math.max(0.55, minConfidence - 0.1)) {
    return true;
  }
  if (SPELLING_FINAL_RE.test(trimmed) && confidence >= Math.max(0.45, minConfidence - 0.2)) {
    return true;
  }
  if (words < minWords) {
    if (words === 1 && trimmed.length >= 3) return confidence >= Math.max(0.7, minConfidence);
    return false;
  }
  if (words === 2) return confidence >= Math.max(0.65, minConfidence);
  return confidence >= minConfidence;
}

function parseAzureConfidence(result: sdk.SpeechRecognitionResult): number {
  try {
    const json = JSON.parse(result.json) as { NBest?: Array<{ Confidence?: number }> };
    const confidence = json.NBest?.[0]?.Confidence;
    return typeof confidence === 'number' ? confidence : 1;
  } catch {
    return 1;
  }
}

export class AzureSTT extends stt.STT {
  #opts: AzureSTTRuntimeOpts;

  constructor(opts: AzureSTTOptions = {}) {
    super({ streaming: true, interimResults: true });
    const speechKey = opts.speechKey ?? process.env.AZURE_SPEECH_KEY ?? '';
    const speechRegion = opts.speechRegion ?? process.env.AZURE_SPEECH_REGION ?? 'centralindia';
    if (!speechKey) {
      throw new Error('AZURE_SPEECH_KEY is required for Azure STT');
    }
    this.#opts = {
      speechKey,
      speechRegion,
      language: opts.language ?? 'en-IN',
      languages: opts.languages ?? parseVoiceLanguages(process.env.AZURE_STT_LANGUAGES),
      sampleRate: opts.sampleRate ?? 16000,
      minFinalWords: opts.minFinalWords ?? DEFAULT_OPTS.minFinalWords,
      minFinalConfidence: opts.minFinalConfidence ?? DEFAULT_OPTS.minFinalConfidence,
      silenceTimeoutMs: opts.silenceTimeoutMs ?? DEFAULT_OPTS.silenceTimeoutMs,
      phraseList: opts.phraseList ?? [],
      onUnclearSpeech: opts.onUnclearSpeech,
      onError: opts.onError,
    };
  }

  get label() {
    return 'azure.STT';
  }

  get model() {
    return 'azure-speech';
  }

  get provider() {
    return 'Azure';
  }

  protected async _recognize(): Promise<stt.SpeechEvent> {
    throw new Error('Azure STT only supports streaming via stream()');
  }

  stream(options?: { connOptions?: APIConnectOptions }) {
    return new AzureSpeechStream(this, this.#opts, options?.connOptions);
  }
}

class AzureSpeechStream extends stt.SpeechStream {
  #opts: AzureSTTRuntimeOpts;
  #logger = log();
  #speaking = false;
  #detectedLocale = 'en-IN';
  #multilingual: boolean;
  #lastFinalText = '';
  #lastFinalAt = 0;

  constructor(
    sttInstance: AzureSTT,
    opts: AzureSTTRuntimeOpts,
    connOptions?: APIConnectOptions,
  ) {
    super(sttInstance, opts.sampleRate, connOptions);
    this.#opts = opts;
    this.#multilingual = toAzureLocales(opts.languages).length > 1;
  }

  get label() {
    return 'azure.SpeechStream';
  }

  protected async run(): Promise<void> {
    // Free (F0) Speech closes the realtime websocket roughly every tens of seconds
    // with "Quota exceeded". LiveKit only retries 3 times then kills the call — so
    // we reconnect inside run() for as long as the session is alive.
    let consecutiveQuotaDrops = 0;
    while (!this.abortSignal.aborted) {
      try {
        await this.#runSession();
        return;
      } catch (err) {
        const isQuota =
          err instanceof APIError &&
          err.retryable &&
          /quota exceeded/i.test(err.message);
        if (!isQuota || this.abortSignal.aborted) {
          throw err;
        }
        consecutiveQuotaDrops += 1;
        this.#speaking = false;
        this.#logger.warn(
          { attempt: consecutiveQuotaDrops },
          'Azure STT quota drop — closing socket and reconnecting',
        );
        if (consecutiveQuotaDrops === 1 || consecutiveQuotaDrops % 3 === 0) {
          this.#opts.onError?.(
            `${err.message} Reconnecting (free-tier limit; upgrade to S0 for stable calls).`,
          );
        }
        // F0 concurrent slot must fully free before opening another websocket.
        await delay(4000);
      }
    }
  }

  async #runSession(): Promise<void> {
    const azureLocales = toAzureLocales(this.#opts.languages);
    const speechConfig = createSpeechConfig(
      this.#opts.speechKey,
      this.#opts.speechRegion,
      azureLocales,
      this.#opts.silenceTimeoutMs,
    );

    const pushStream = this.#createPushStream();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    let recognizer: sdk.SpeechRecognizer;
    if (azureLocales.length > 1) {
      const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(azureLocales);
      recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);
    } else {
      recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    }

    if (this.#opts.phraseList.length > 0) {
      const phraseListGrammar = sdk.PhraseListGrammar.fromRecognizer(recognizer);
      for (const phrase of this.#opts.phraseList) {
        phraseListGrammar.addPhrase(phrase);
      }
    }

    recognizer.sessionStopped = () => {
      this.#logger.debug('Azure STT session stopped');
    };

    await this.#runRecognizer(recognizer, pushStream);
  }

  #createPushStream() {
    const format = sdk.AudioStreamFormat.getWaveFormatPCM(this.#opts.sampleRate, 16, 1);
    return sdk.AudioInputStream.createPushStream(format);
  }

  async #runRecognizer(
    recognizer: sdk.SpeechRecognizer,
    pushStream: sdk.PushAudioInputStream,
  ): Promise<void> {
    const abortController = new AbortController();
    let fatalError: APIError | undefined;

    // Free (F0) allows only 1 concurrent realtime STT socket. On cancel we must
    // stop audio, close the recognizer, wait for the slot to free, then throw a
    // retryable APIError so #run() can reopen a new session without killing the call.
    recognizer.canceled = (_s, e) => {
      if (e.reason !== sdk.CancellationReason.Error) return;
      const message = formatAzureSttErrorMessage(
        e.errorDetails,
        e.errorCode,
        this.#opts.speechRegion,
      );
      this.#logger.error(
        { details: e.errorDetails, errorCode: e.errorCode },
        'Azure STT canceled with error',
      );
      fatalError = new APIError(message, { retryable: true });
      abortController.abort();
    };

    recognizer.recognizing = (_s, e) => {
      if (e.result.text) this.#logger.debug({ text: e.result.text }, 'Azure STT recognizing');
      this.#applyDetectedLocale(e.result);
      if (e.result.reason !== sdk.ResultReason.RecognizingSpeech) return;

      if (!this.#speaking) {
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

      if (e.result.text) {
        this.#emitTranscript(stt.SpeechEventType.INTERIM_TRANSCRIPT, e.result.text);
      }
    };

    recognizer.recognized = (_s, e) => {
      this.#applyDetectedLocale(e.result);
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text) {
        const text = e.result.text.trim();
        const words = countWords(text);
        const confidence = parseAzureConfidence(e.result);
        if (!shouldAcceptFinal(
          text,
          confidence,
          this.#opts.minFinalWords,
          this.#opts.minFinalConfidence,
        )) {
          this.#logger.debug(
            { text, words, confidence },
            'Azure STT low-quality final skipped (background noise filter)',
          );
          this.#opts.onUnclearSpeech?.({ text, confidence });
          if (this.#speaking && !this.queue.closed) {
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
          return;
        }

        if (this.#isDuplicateFinal(text)) {
          this.#logger.debug({ text }, 'Azure STT duplicate final skipped');
          return;
        }
        this.#logger.debug({ text, confidence }, 'Azure STT recognized');
        this.#emitTranscript(stt.SpeechEventType.FINAL_TRANSCRIPT, text, confidence);
        if (this.#speaking && !this.queue.closed) {
          this.#speaking = false;
          this.queue.put({
            type: stt.SpeechEventType.END_OF_SPEECH,
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
      } else if (e.result.reason === sdk.ResultReason.NoMatch) {
        this.#logger.debug('Azure STT no match for audio segment');
        if (this.#speaking && !this.queue.closed) {
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
    };

    try {
      await startContinuousRecognition(recognizer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#logger.error({ err: message }, 'Azure STT failed to start recognition');
      this.#opts.onError?.(message);
      throw err instanceof APIError
        ? err
        : new APIError(message, { retryable: true });
    }

    try {
      await this.#sendAudio(pushStream, abortController.signal);
      if (!fatalError) {
        // Azure needs trailing silence + time to finalize the last utterance before the
        // push stream is closed; closing immediately drops in-flight recognition.
        pushStream.write(new ArrayBuffer(this.#opts.sampleRate * 2));
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    } finally {
      abortController.abort();
      try {
        pushStream.close();
      } catch {
        // already closed after cancel
      }
      await new Promise<void>((resolve) => {
        recognizer.stopContinuousRecognitionAsync(() => {
          try {
            recognizer.close();
          } catch {
            // already closed after cancel
          }
          resolve();
        });
      });
    }

    if (fatalError) {
      // F0 concurrency slot often needs a beat to free after websocket 1007.
      if (/quota exceeded/i.test(fatalError.message)) {
        await delay(1500);
      }
      throw fatalError;
    }
    this.close();
  }

  #normalizeFinalText(text: string): string {
    return text.replace(/[।.!?,;:]+$/u, '').trim();
  }

  #isDuplicateFinal(text: string): boolean {
    const now = Date.now();
    const normalized = this.#normalizeFinalText(text);
    const lastNormalized = this.#normalizeFinalText(this.#lastFinalText);
    const duplicateWindowMs = 1500;
    if (
      normalized &&
      normalized === lastNormalized &&
      now - this.#lastFinalAt < duplicateWindowMs
    ) {
      return true;
    }
    this.#lastFinalText = text;
    this.#lastFinalAt = now;
    return false;
  }

  #applyDetectedLocale(result: sdk.SpeechRecognitionResult) {
    if (!this.#multilingual) return;
    try {
      const detected = sdk.AutoDetectSourceLanguageResult.fromResult(result);
      if (detected?.language) {
        this.#detectedLocale = detected.language;
      }
    } catch {
      // Ignore language-detection errors on partial results.
    }
  }

  #emitTranscript(type: stt.SpeechEventType, text: string, confidence = 0) {
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
    pushStream: sdk.PushAudioInputStream,
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
        pushStream.write(new Int16Array(frame.data).buffer);
      }

      if (data === stt.SpeechStream.FLUSH_SENTINEL) {
        // Help Azure finalize the current utterance when LiveKit signals turn end.
        pushStream.write(new ArrayBuffer(this.#opts.sampleRate * 2));
      }
    }
  }
}
