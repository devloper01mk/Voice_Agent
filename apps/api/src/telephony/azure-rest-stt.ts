import {
  isAzureSttQuotaError,
  markAzureSpeechQuota,
  pickSingleLocale,
  getTelephonySttSilenceMs,
  telephonyAzureLocales,
  type TelephonySttOptions,
} from './azure-push-stt.js';

const ENERGY_THRESHOLD = 420;
const END_SILENCE_MS = () => getTelephonySttSilenceMs();
const MIN_UTTERANCE_MS = 450;
const MAX_UTTERANCE_MS = 8_000;
const SAMPLE_RATE = 16_000;

function azureLanguage(languages?: string): string {
  return pickSingleLocale(telephonyAzureLocales(languages), languages);
}

function pcmAvgEnergy(pcm: Buffer): number {
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) energy += Math.abs(pcm.readInt16LE(i));
  return energy / (pcm.length / 2 || 1);
}

function frameMs(pcm: Buffer): number {
  return (pcm.byteLength / 2 / SAMPLE_RATE) * 1000;
}

function pcm16ToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Azure short-audio REST STT. Avoids the F0 *websocket* 1-connection cap.
 * Monthly F0 hours still apply — REST returns 400 Quota exceeded when that is gone.
 */
export class TelephonyAzureRestStt {
  #opts: TelephonySttOptions;
  #key: string;
  #region: string;
  #language: string;
  #closed = false;
  #started = false;
  #inSpeech = false;
  #speechMs = 0;
  #silenceMs = 0;
  #buf: Buffer[] = [];
  #busy = false;
  #queued: { pcm: Buffer; durationMs: number } | null = null;
  #abort = new AbortController();
  #quotaBlocked = false;

  constructor(opts: TelephonySttOptions) {
    const key = process.env.AZURE_SPEECH_KEY?.trim();
    const region = process.env.AZURE_SPEECH_REGION?.trim() ?? 'centralindia';
    if (!key) throw new Error('AZURE_SPEECH_KEY is not configured');
    this.#opts = opts;
    this.#key = key;
    this.#region = region;
    this.#language = azureLanguage(opts.languages);
  }

  get ready(): boolean {
    return this.#started && !this.#closed;
  }

  get locale(): string {
    return `${this.#language} (rest)`;
  }

  async start(): Promise<void> {
    if (this.#closed || this.#started) return;
    this.#started = true;
    this.#opts.onReady?.();
  }

  pushPcm16_16k(pcm: Buffer): void {
    if (this.#closed || !this.#started || this.#quotaBlocked) return;
    const ms = frameMs(pcm);
    const voiced = pcmAvgEnergy(pcm) >= ENERGY_THRESHOLD;
    const copy = Buffer.from(pcm);

    if (voiced) {
      if (!this.#inSpeech) {
        this.#inSpeech = true;
        this.#speechMs = 0;
        this.#silenceMs = 0;
        this.#buf = [];
      }
      this.#buf.push(copy);
      this.#speechMs += ms;
      this.#silenceMs = 0;
      if (this.#speechMs >= MAX_UTTERANCE_MS) this.#commit();
      return;
    }

    if (!this.#inSpeech) return;
    this.#buf.push(copy);
    this.#silenceMs += ms;
    if (this.#silenceMs >= END_SILENCE_MS()) this.#commit();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#started = false;
    this.#buf = [];
    this.#queued = null;
    this.#abort.abort();
  }

  #commit(): void {
    this.#inSpeech = false;
    const pcm = Buffer.concat(this.#buf);
    const durationMs = this.#speechMs;
    this.#buf = [];
    this.#speechMs = 0;
    this.#silenceMs = 0;
    if (durationMs < MIN_UTTERANCE_MS) {
      this.#opts.onNoMatch?.();
      return;
    }
    void this.#transcribe(pcm, durationMs);
  }

  async #transcribe(pcm: Buffer, durationMs: number): Promise<void> {
    if (this.#closed || this.#quotaBlocked) return;
    if (this.#busy) {
      this.#queued = { pcm, durationMs };
      return;
    }
    this.#busy = true;
    try {
      const text = await this.#request(pcm);
      if (this.#closed) return;
      if (!text) this.#opts.onNoMatch?.();
      else this.#opts.onFinal(text, durationMs);
    } catch (err) {
      if (this.#closed) return;
      const message = err instanceof Error ? err.message : 'Azure REST STT failed';
      if (isAzureSttQuotaError(message)) {
        this.#quotaBlocked = true;
        this.#queued = null;
        markAzureSpeechQuota();
      }
      this.#opts.onError?.(message);
    } finally {
      this.#busy = false;
      const queued = this.#queued;
      this.#queued = null;
      if (queued && !this.#closed && !this.#quotaBlocked) {
        void this.#transcribe(queued.pcm, queued.durationMs);
      }
    }
  }

  async #request(pcm: Buffer): Promise<string | null> {
    const wav = pcm16ToWav(pcm);
    const url =
      `https://${this.#region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(this.#language)}&format=simple`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.#key,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: new Uint8Array(wav),
      signal: this.#abort.signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 180);
      throw new Error(`Azure REST STT ${res.status}${body ? `: ${body}` : ''}`);
    }
    const json = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string };
    const text = json.DisplayText?.trim() ?? '';
    if (json.RecognitionStatus !== 'Success' || !text) return null;
    return text;
  }
}
