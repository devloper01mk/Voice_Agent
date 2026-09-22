import { detectTtsLanguage, lockSpokenHinglishGender, parseVoiceLanguages, rewriteRahiForSpeech } from '@vsa/shared';
import { CARTESIA_API_VERSION, DEFAULT_CARTESIA_TTS_MODEL } from '../cartesia.js';

export interface TelephonyTtsOptions {
  text: string;
  voiceId: string;
  voiceLanguages?: string;
  speed?: number;
  pitch?: number;
  modelId?: string;
  sampleRate?: number;
  emotion?: string;
  language?: string;
  agentGender?: string;
}

const MULAW_FRAME_BYTES = 800;
const MULAW_SILENCE = 0xff;

export type MulawFrameHandler = (frame: Buffer) => boolean | Promise<boolean>;

function ttsBody(opts: TelephonyTtsOptions) {
  const modelId = opts.modelId ?? process.env.CARTESIA_MODEL_ID ?? DEFAULT_CARTESIA_TTS_MODEL;
  const voiceId = opts.voiceId || process.env.CARTESIA_VOICE_ID || '';
  const speed = opts.speed ?? 1.0;
  const pitch = opts.pitch ?? 1.0;
  const languages = parseVoiceLanguages(opts.voiceLanguages);
  const language = opts.language ?? detectTtsLanguage(opts.text, languages);

  const generationConfig: Record<string, unknown> = {
    speed,
    volume: Math.min(2, Math.max(0.5, pitch)),
  };
  const emotion = opts.emotion?.trim();
  if (emotion && emotion !== 'neutral') generationConfig.emotion = emotion;

  return {
    model_id: modelId,
    transcript: rewriteRahiForSpeech(lockSpokenHinglishGender(opts.text, opts.agentGender)),
    language,
    voice: { mode: 'id' as const, id: voiceId },
    output_format: {
      container: 'raw' as const,
      encoding: 'pcm_mulaw' as const,
      sample_rate: 8000,
    },
    generation_config: generationConfig,
  };
}

function extractAudioB64(parsed: {
  type?: string;
  data?: unknown;
  audio?: unknown;
  error?: unknown;
}): string | null {
  if (parsed.type === 'error') {
    throw new Error(typeof parsed.error === 'string' ? parsed.error : 'Cartesia SSE error');
  }
  if (parsed.type === 'done' || parsed.type === 'timestamps') return null;
  if (parsed.type && parsed.type !== 'chunk' && parsed.type !== 'audio') return null;
  if (typeof parsed.data === 'string' && parsed.data) return parsed.data;
  if (typeof parsed.audio === 'string' && parsed.audio) return parsed.audio;
  return null;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 12_000;
const CONNECT_RETRIES = 1;

function resolveConnectTimeoutMs(): number {
  const raw = Number(process.env.CARTESIA_CONNECT_TIMEOUT_MS ?? DEFAULT_CONNECT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CONNECT_TIMEOUT_MS;
}

async function fetchCartesiaSse(apiKey: string, body: unknown): Promise<Response> {
  const timeoutMs = resolveConnectTimeoutMs();
  let lastError: unknown;
  for (let attempt = 0; attempt <= CONNECT_RETRIES; attempt++) {
    const connectAbort = new AbortController();
    // Only abort if headers never arrive — do NOT AbortSignal.timeout the whole stream
    // (that cuts mid-utterance with "operation was aborted due to timeout").
    const connectTimer = setTimeout(() => connectAbort.abort(), timeoutMs);
    try {
      const response = await fetch('https://api.cartesia.ai/tts/sse', {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Cartesia-Version': CARTESIA_API_VERSION,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: connectAbort.signal,
      });
      clearTimeout(connectTimer);
      return response;
    } catch (err) {
      clearTimeout(connectTimer);
      lastError = connectAbort.signal.aborted
        ? new Error(`Cartesia TTS connect timeout after ${timeoutMs}ms`)
        : err;
      if (attempt < CONNECT_RETRIES) {
        console.warn(
          `[telephony] Cartesia TTS connect failed (attempt ${attempt + 1}/${CONNECT_RETRIES + 1}), retrying`,
          lastError instanceof Error ? lastError.message : lastError,
        );
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Cartesia TTS connect failed');
}

/** Stream Cartesia SSE μ-law into 100ms (800-byte) frames as they arrive. */
export async function streamMulaw8kFrames(
  opts: TelephonyTtsOptions,
  onFrame: MulawFrameHandler,
): Promise<{ ttfbMs: number; frames: number }> {
  const apiKey = process.env.CARTESIA_API_KEY?.trim();
  if (!apiKey) throw new Error('CARTESIA_API_KEY is not configured');
  if (!/[\p{L}\p{N}]/u.test(opts.text)) return { ttfbMs: 0, frames: 0 };

  const started = Date.now();
  const response = await fetchCartesiaSse(apiKey, ttsBody(opts));

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 400 && /empty|punctuation/i.test(err)) {
      return { ttfbMs: 0, frames: 0 };
    }
    throw new Error(`Cartesia TTS failed (${response.status}): ${err.slice(0, 200)}`);
  }
  if (!response.body) throw new Error('Cartesia TTS returned an empty stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = '';
  let mulawBuf = Buffer.alloc(0);
  let frames = 0;
  let ttfbMs = 0;
  let aborted = false;

  const flushFrames = async (end: boolean): Promise<boolean> => {
    while (mulawBuf.length >= MULAW_FRAME_BYTES) {
      const frame = mulawBuf.subarray(0, MULAW_FRAME_BYTES);
      mulawBuf = mulawBuf.subarray(MULAW_FRAME_BYTES);
      if (!ttfbMs) ttfbMs = Date.now() - started;
      frames += 1;
      if ((await onFrame(frame)) === false) {
        aborted = true;
        return false;
      }
    }
    if (end && mulawBuf.length > 0) {
      const padded = Buffer.alloc(MULAW_FRAME_BYTES, MULAW_SILENCE);
      mulawBuf.copy(padded);
      mulawBuf = Buffer.alloc(0);
      if (!ttfbMs) ttfbMs = Date.now() - started;
      frames += 1;
      if ((await onFrame(padded)) === false) {
        aborted = true;
        return false;
      }
    }
    return true;
  };

  const handleEvent = async (raw: string): Promise<boolean> => {
    if (!raw || raw === '[DONE]') return true;
    let parsed: { type?: string; data?: unknown; audio?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return true;
    }
    const b64 = extractAudioB64(parsed);
    if (!b64) return true;
    mulawBuf = Buffer.concat([mulawBuf, Buffer.from(b64, 'base64')]);
    return flushFrames(false);
  };

  try {
    while (!aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuf += decoder.decode(value, { stream: true });
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        if (!(await handleEvent(trimmed.slice(5).trim()))) {
          aborted = true;
          break;
        }
      }
    }
    if (!aborted && lineBuf.trim().startsWith('data:')) {
      await handleEvent(lineBuf.trim().slice(5).trim());
    }
    if (!aborted) await flushFrames(true);
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }

  return { ttfbMs, frames };
}

export async function synthesizeMulaw8k(opts: TelephonyTtsOptions): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await streamMulaw8kFrames(opts, (frame) => {
    chunks.push(frame);
    return true;
  });
  return Buffer.concat(chunks);
}
