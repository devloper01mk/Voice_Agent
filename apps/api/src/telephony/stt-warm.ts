import type { SttProvider } from '@vsa/shared';
import { normalizeSttProvider } from '@vsa/shared';
import { TelephonyGooglePushStt } from './google-push-stt.js';
import { TelephonyPushStt, warmAzureSpeechCredentials } from './azure-push-stt.js';
import { TelephonySarvamPushStt } from './sarvam-push-stt.js';

export interface WarmTelephonyStt {
  readonly provider: SttProvider;
  adoptHandlers(opts: import('./azure-push-stt.js').TelephonySttOptions): void;
  start(): Promise<void>;
  close(): Promise<void>;
  get ready(): boolean;
  get locale(): string;
}

let warmedStt: WarmTelephonyStt | null = null;
let warmCallId: string | null = null;

function noopSttOptions(languages?: string): import('./azure-push-stt.js').TelephonySttOptions {
  return {
    languages,
    onFinal: () => undefined,
    onInterim: () => undefined,
    onError: () => undefined,
    onNoMatch: () => undefined,
  };
}

function createWarmStt(
  provider: SttProvider,
  languages?: string,
  sttModel?: string | null,
): WarmTelephonyStt | null {
  const opts = noopSttOptions(languages);
  if (provider === 'sarvam') {
    try {
      return Object.assign(new TelephonySarvamPushStt(opts, sttModel), { provider: 'sarvam' as const });
    } catch {
      return null;
    }
  }
  if (provider === 'google') {
    try {
      return Object.assign(new TelephonyGooglePushStt(opts, sttModel), { provider: 'google' as const });
    } catch {
      return null;
    }
  }
  if (provider === 'azure') {
    return Object.assign(new TelephonyPushStt(opts), { provider: 'azure' as const });
  }
  return null;
}

/** Start STT while the phone is still ringing so connect→listen is faster. */
export function warmTelephonySttForCall(
  callId: string,
  opts: { languages?: string; sttProvider?: string | null; sttModel?: string | null },
): void {
  const provider = normalizeSttProvider(opts.sttProvider);
  if (provider === 'openai') return;

  warmCallId = callId;
  if (provider === 'azure') {
    void warmAzureSpeechCredentials();
  }

  const stt = createWarmStt(provider, opts.languages, opts.sttModel);
  if (!stt) return;

  void stt.start().then(() => {
    if (warmCallId !== callId) {
      void stt.close();
      return;
    }
    if (warmedStt && warmedStt !== stt) void warmedStt.close();
    warmedStt = stt;
  }).catch(() => {
    if (warmedStt === stt) warmedStt = null;
  });
}

export function takeWarmedTelephonyStt(callId: string): WarmTelephonyStt | null {
  if (warmCallId !== callId || !warmedStt) return null;
  warmCallId = null;
  const stt = warmedStt;
  warmedStt = null;
  return stt;
}

export function dropWarmedTelephonyStt(callId: string): void {
  if (warmCallId !== callId) return;
  warmCallId = null;
  const stt = warmedStt;
  warmedStt = null;
  if (stt) void stt.close();
}
