import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { parseVoiceLanguages, type SpeakLanguage } from '@vsa/shared';
import { getTelephonyLatencyTuning } from './latency-profile.js';

export interface TelephonySttOptions {
  onFinal: (text: string, durationMs?: number) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  onNoMatch?: () => void;
  onReady?: () => void;
  languages?: string;
  phraseList?: string[];
}

export function toAzureLocales(languages: SpeakLanguage[]): string[] {
  const locales = new Set<string>();
  for (const lang of languages) {
    if (lang === 'en' || lang === 'hinglish') locales.add('en-IN');
    if (lang === 'hi' || lang === 'hinglish') locales.add('hi-IN');
  }
  return locales.size ? [...locales] : ['en-IN', 'hi-IN'];
}

/** F0 / one-socket SKUs cannot run AutoDetect LID. */
export function pickSingleLocale(locales: string[], languages?: string): string {
  const parsed = languages ? parseVoiceLanguages(languages) : [];
  const hasEn = parsed.includes('en') || parsed.includes('hinglish');
  const hasHi = parsed.includes('hi') || parsed.includes('hinglish');
  if (hasHi && !hasEn && locales.includes('hi-IN')) return 'hi-IN';
  if (hasEn && !hasHi && locales.includes('en-IN')) return 'en-IN';
  if (locales.includes('en-IN')) return 'en-IN';
  return locales[0] ?? 'en-IN';
}

export function telephonyAzureLocales(languages?: string): string[] {
  return toAzureLocales(parseVoiceLanguages(languages));
}

function pcmExactArrayBuffer(pcm: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(pcm.byteLength);
  new Uint8Array(out).set(pcm);
  return out;
}

export function isAzureSttQuotaError(message: string): boolean {
  return /quota exceeded|websocket error code:\s*1007/i.test(message);
}

export function isAzureAutodetectFallbackMessage(message: string): boolean {
  return /autodetect unavailable|falling back to/i.test(message);
}

export const AZURE_SPEECH_QUOTA_HINT =
  'Azure Speech quota exceeded (F0). Realtime and REST STT are both blocked until you upgrade this Speech resource to Standard S0 in Azure Portal, or wait for the monthly free allowance to reset.';

async function probeAzureSpeechKey(key: string, region: string): Promise<void> {
  const res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Length': '0',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `Azure Speech key rejected (${res.status}) for region ${region}. Update AZURE_SPEECH_KEY in apps/api/.env.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Azure Speech token probe failed (${res.status})`);
  }
}

function startRecognition(recognizer: sdk.SpeechRecognizer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Azure STT failed to start within ${timeoutMs}ms`));
    }, timeoutMs);
    recognizer.startContinuousRecognitionAsync(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(new Error(String(err)));
      },
    );
  });
}

function stopRecognizer(recognizer: sdk.SpeechRecognizer): Promise<void> {
  return new Promise((resolve) => {
    try {
      recognizer.stopContinuousRecognitionAsync(
        () => {
          try {
            recognizer.close();
          } catch {
            /* ignore */
          }
          resolve();
        },
        () => {
          try {
            recognizer.close();
          } catch {
            /* ignore */
          }
          resolve();
        },
      );
    } catch {
      try {
        recognizer.close();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}

sdk.Recognizer.enableTelemetry(false);

let liveAzure: TelephonyPushStt | null = null;
let startLock: Promise<void> = Promise.resolve();
let azureQuotaCooldownUntil = 0;
const AZURE_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
/** After AutoDetect 1007, skip LID briefly so F0 can open one socket — next calls retry. */
let azureLidBlockedUntil = 0;
export const AZURE_LID_BLOCK_MS = 90 * 1000;

export function markAzureSpeechQuota(): void {
  azureQuotaCooldownUntil = Date.now() + AZURE_QUOTA_COOLDOWN_MS;
}

export function azureSpeechOnCooldown(): boolean {
  return Date.now() < azureQuotaCooldownUntil;
}

function markAzureLidBlocked(): void {
  azureLidBlockedUntil = Date.now() + AZURE_LID_BLOCK_MS;
}

export function azureLidAllowed(): boolean {
  if (process.env.AZURE_SPEECH_LID === '0') return false;
  return Date.now() >= azureLidBlockedUntil;
}

export function azureAutodetectFallbackMessage(locale: string, detail?: string): string {
  const extra = detail?.trim() ? ` (${detail.trim().slice(0, 80)})` : '';
  const retrySec = Math.round(AZURE_LID_BLOCK_MS / 1000);
  return (
    `Azure AutoDetect unavailable — this call uses ${locale} only. Hindi may be misheard. ` +
    `AutoDetect retries in ~${retrySec}s. Upgrade Speech to S0 to keep en-IN+hi-IN.${extra}`
  );
}

export function resetAzureLidBlockForTests(): void {
  azureLidBlockedUntil = 0;
}

/** Azure end-of-phrase silence — driven by LATENCY_PROFILE (telephony). */
export function getTelephonySttSilenceMs(): number {
  return getTelephonyLatencyTuning().sttSilenceMs;
}

/** @deprecated Use getTelephonySttSilenceMs() */
export const TELEPHONY_STT_SILENCE_MS = 450;

export async function warmAzureSpeechCredentials(): Promise<void> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim() ?? 'centralindia';
  if (!key) return;
  await probeAzureSpeechKey(key, region);
}

function applySilenceTimeouts(speechConfig: sdk.SpeechConfig): void {
  const silenceMs = getTelephonySttSilenceMs();
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    String(silenceMs),
  );
  speechConfig.setProperty(
    sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
    String(silenceMs),
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    '15000',
  );
}

/**
 * Realtime Azure STT. Tries AutoDetect (en-IN + hi-IN) like Simulator 2.
 * F0 one-socket SKUs fail LID with websocket 1007 — we then fall back to a
 * single locale without entering the monthly-quota cooldown.
 */
export class TelephonyPushStt {
  #recognizer: sdk.SpeechRecognizer | null = null;
  #pushStream: sdk.PushAudioInputStream | null = null;
  #closed = false;
  #started = false;
  #recovering = false;
  #recoveries = 0;
  #lidFallingBack = false;
  #usingLid = false;
  #lastQuotaErrorAt = 0;
  #opts: TelephonySttOptions;
  readonly #key: string;
  readonly #region: string;
  readonly #locales: string[];

  constructor(opts: TelephonySttOptions) {
    const key = process.env.AZURE_SPEECH_KEY?.trim();
    const region = process.env.AZURE_SPEECH_REGION?.trim() ?? 'centralindia';
    if (!key) throw new Error('AZURE_SPEECH_KEY is not configured');
    this.#opts = opts;
    this.#key = key;
    this.#region = region;
    this.#locales = telephonyAzureLocales(opts.languages);
    this.#usingLid = this.#locales.length > 1 && azureLidAllowed();
  }

  get ready(): boolean {
    return this.#started && !this.#closed;
  }

  get locale(): string {
    if (this.#usingLid && this.#locales.length > 1) return this.#locales.join(',');
    return pickSingleLocale(this.#locales, this.#opts.languages);
  }

  /** Rebind live callbacks when adopting a pre-warmed recognizer. */
  adoptHandlers(opts: TelephonySttOptions): void {
    this.#opts = opts;
    this.#wireRecognizerEvents();
    if (this.#started) this.#opts.onReady?.();
  }

  async start(): Promise<void> {
    if (this.#closed || this.#started) return;
    const previous = startLock;
    let release: () => void = () => undefined;
    startLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (liveAzure && liveAzure !== this) await liveAzure.close();
      liveAzure = this;
      await probeAzureSpeechKey(this.#key, this.#region);
      await this.#open();
    } finally {
      release();
    }
  }

  async #open(): Promise<void> {
    await this.#teardownRecognizer();
    this.#bindRecognizer();
    try {
      await startRecognition(this.#recognizer!, 12_000);
    } catch (err) {
      if (this.#canFallbackLid()) {
        const ok = await this.#fallbackToSingleLocale(err);
        if (!ok && !this.#closed) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        return;
      }
      throw err;
    }
    this.#started = true;
    this.#opts.onReady?.();
  }

  #bindRecognizer(): void {
    const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    this.#pushStream = sdk.AudioInputStream.createPushStream(format);
    const audioConfig = sdk.AudioConfig.fromStreamInput(this.#pushStream);

    const useLid = this.#usingLid && this.#locales.length > 1;
    let speechConfig: sdk.SpeechConfig;
    if (useLid) {
      const endpoint = `wss://${this.#region}.stt.speech.microsoft.com/speech/universal/v2`;
      speechConfig = sdk.SpeechConfig.fromEndpoint(new URL(endpoint), this.#key);
      speechConfig.setProperty(
        sdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
        'Continuous',
      );
    } else {
      speechConfig = sdk.SpeechConfig.fromSubscription(this.#key, this.#region);
      speechConfig.speechRecognitionLanguage = pickSingleLocale(this.#locales, this.#opts.languages);
    }
    applySilenceTimeouts(speechConfig);

    this.#recognizer = useLid
      ? sdk.SpeechRecognizer.FromConfig(
          speechConfig,
          sdk.AutoDetectSourceLanguageConfig.fromLanguages(this.#locales),
          audioConfig,
        )
      : new sdk.SpeechRecognizer(speechConfig, audioConfig);

    const phrases = this.#opts.phraseList?.filter(Boolean) ?? [];
    if (phrases.length) {
      const grammar = sdk.PhraseListGrammar.fromRecognizer(this.#recognizer);
      for (const phrase of phrases.slice(0, 100)) grammar.addPhrase(phrase);
    }

    this.#wireRecognizerEvents();
  }

  #wireRecognizerEvents(): void {
    if (!this.#recognizer) return;

    this.#recognizer.recognizing = (_s, e) => {
      const text = e.result.text?.trim();
      if (text) this.#opts.onInterim?.(text);
    };

    this.#recognizer.recognized = (_s, e) => {
      if (e.result.reason === sdk.ResultReason.NoMatch) {
        this.#opts.onNoMatch?.();
        return;
      }
      if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
      const text = e.result.text?.trim();
      if (!text) return;
      const durationMs =
        typeof e.result.duration === 'number' ? e.result.duration / 10_000 : undefined;
      this.#opts.onFinal(text, durationMs);
    };

    this.#recognizer.canceled = (_s, e) => {
      if (e.reason !== sdk.CancellationReason.Error) return;
      const details = e.errorDetails || 'Azure STT canceled';
      this.#started = false;
      if (this.#canFallbackLid() && isAzureSttQuotaError(details)) {
        void this.#fallbackToSingleLocale(details);
        return;
      }
      const quota = isAzureSttQuotaError(details);
      const now = Date.now();
      if (quota) {
        markAzureSpeechQuota();
        if (now - this.#lastQuotaErrorAt < 2000) return;
        this.#lastQuotaErrorAt = now;
      }
      this.#opts.onError?.(details);
      if (quota) return;
      void this.#recover();
    };
  }

  #canFallbackLid(): boolean {
    return this.#usingLid && this.#locales.length > 1 && !this.#closed && !this.#lidFallingBack;
  }

  async #fallbackToSingleLocale(cause: unknown): Promise<boolean> {
    if (!this.#canFallbackLid()) return false;
    this.#lidFallingBack = true;
    this.#usingLid = false;
    markAzureLidBlocked();
    const locale = pickSingleLocale(this.#locales, this.#opts.languages);
    const detail = cause instanceof Error ? cause.message : String(cause);
    this.#opts.onError?.(azureAutodetectFallbackMessage(locale, detail));
    try {
      await this.#teardownRecognizer();
      // F0 concurrent slot must free before the single-locale websocket opens.
      await new Promise((r) => setTimeout(r, 2000));
      if (this.#closed) return false;
      await this.#open();
      return this.#started;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Azure STT failed to start';
      this.#opts.onError?.(message);
      return false;
    } finally {
      this.#lidFallingBack = false;
    }
  }

  async #recover(): Promise<void> {
    if (this.#closed || this.#recovering || this.#recoveries >= 1) return;
    this.#recovering = true;
    this.#recoveries += 1;
    try {
      await new Promise((r) => setTimeout(r, 1500));
      if (this.#closed) return;
      await this.#open();
    } catch {
      /* stay down */
    } finally {
      this.#recovering = false;
    }
  }

  async #teardownRecognizer(): Promise<void> {
    this.#started = false;
    const recognizer = this.#recognizer;
    const stream = this.#pushStream;
    this.#recognizer = null;
    this.#pushStream = null;
    try {
      stream?.close();
    } catch {
      /* ignore */
    }
    if (recognizer) await stopRecognizer(recognizer);
  }

  pushPcm16_16k(pcm: Buffer): void {
    if (this.#closed || !this.#pushStream) return;
    const copy = Buffer.from(pcm);
    this.#pushStream.write(pcmExactArrayBuffer(copy));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (liveAzure === this) liveAzure = null;
    const recognizer = this.#recognizer;
    const stream = this.#pushStream;
    this.#recognizer = null;
    this.#pushStream = null;
    try {
      stream?.close();
    } catch {
      /* ignore */
    }
    if (recognizer) await stopRecognizer(recognizer);
  }
}
