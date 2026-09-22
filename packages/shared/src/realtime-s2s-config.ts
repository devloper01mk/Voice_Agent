import {
  DEFAULT_GEMINI_LIVE_LANGUAGE,
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_GEMINI_LIVE_VOICE,
  GEMINI_LIVE_LANGUAGE_OPTIONS,
  GEMINI_LIVE_MODEL_OPTIONS,
  estimateGeminiLiveCostInr,
  resolveGeminiLiveLanguageCode,
  resolveGeminiLiveModel,
  resolveGeminiLiveVoice,
} from './gemini-live-config.js';
import { isGeminiLivePipeline, resolveRealtimeVoice, type VoicePipeline } from './voice-pipeline.js';

export type S2sProvider = 'openai' | 'gemini';

/** Simulator 2.0 → Force OpenAI Realtime S2S session preset id (legacy metadata). */
export const SIMULATOR_FORCE_S2S_PRESET_ID = 'simulator_force_s2s' as const;

export type RealtimeS2sPresetId = typeof SIMULATOR_FORCE_S2S_PRESET_ID;

export type RealtimeS2sNoiseReduction = 'far_field' | 'near_field' | 'off';
export type RealtimeS2sTurnMode = 'normal' | 'semantic';
export type RealtimeS2sEagerness = 'auto' | 'low' | 'medium' | 'high';
export type RealtimeS2sMaxTokensMode = 'unlimited' | 'custom';

/** User-editable Realtime S2S settings from Simulator 2.0. */
export interface RealtimeS2sUserConfig {
  provider: S2sProvider;
  model: string;
  /** Gemini Live BCP-47 language (e.g. hi-IN). Ignored for OpenAI. */
  languageCode: string;
  transcriptionModel: string;
  maxTokensMode: RealtimeS2sMaxTokensMode;
  maxTokensCustom: number;
  voice: string;
  noiseReduction: RealtimeS2sNoiseReduction;
  turnDetectionMode: RealtimeS2sTurnMode;
  turnDetectionThreshold: number;
  turnDetectionPrefixPaddingMs: number;
  turnDetectionSilenceDurationMs: number;
  turnDetectionEagerness: RealtimeS2sEagerness;
  idleTimeoutEnabled: boolean;
}

export interface RealtimeS2sTurnDetectionConfig {
  label: string;
  type: 'server_vad' | 'semantic_vad';
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  eagerness?: RealtimeS2sEagerness;
}

/** Serializable session config published to Simulator UI on call start. */
export interface RealtimeS2sSessionConfig {
  source: 'simulator_force_s2s' | 'studio_default';
  presetId?: RealtimeS2sPresetId;
  provider: S2sProvider;
  pipeline: 'openai_realtime' | 'gemini_live';
  model: string;
  languageCode?: string;
  transcriptionModel: string;
  maxResponseOutputTokens: 'unlimited' | number;
  voice: string;
  noiseReduction?: RealtimeS2sNoiseReduction;
  turnDetection: RealtimeS2sTurnDetectionConfig;
  idleTimeout: boolean;
  modalities: readonly ['text', 'audio'];
  estimatedCostInrPerMin?: string;
}

export const REALTIME_S2S_MODEL_OPTIONS = [
  { value: 'gpt-realtime-mini', label: 'GPT Realtime Mini', hint: 'Budget ~₹2–3.5/min' },
  { value: 'gpt-realtime', label: 'GPT Realtime', hint: 'Balanced quality' },
  { value: 'gpt-realtime-2.1-mini', label: 'GPT Realtime 2.1 Mini', hint: 'Newer mini' },
  { value: 'gpt-realtime-2.1', label: 'GPT Realtime 2.1', hint: 'Best quality' },
] as const;

export const REALTIME_S2S_TRANSCRIPTION_OPTIONS = [
  { value: 'gpt-realtime-whisper', label: 'GPT Realtime Whisper', hint: 'Realtime path' },
  { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe', hint: 'Cheapest' },
  { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', hint: 'Higher quality' },
  { value: 'whisper-1', label: 'Whisper-1', hint: 'Classic' },
] as const;

export const REALTIME_S2S_NOISE_REDUCTION_OPTIONS = [
  { value: 'far_field', label: 'Far field' },
  { value: 'near_field', label: 'Near field' },
  { value: 'off', label: 'Off' },
] as const;

export const REALTIME_S2S_TURN_MODE_OPTIONS = [
  { value: 'normal', label: 'Normal', hint: 'Server VAD — threshold + silence' },
  { value: 'semantic', label: 'Semantic', hint: 'Semantic VAD — eagerness' },
] as const;

export const REALTIME_S2S_EAGERNESS_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export const REALTIME_S2S_TRANSCRIPTION_PROMPT =
  'Indian sales call in Hindi English Hinglish code-mix. Automotive, pricing, demo, callback.';

export const SIMULATOR_FORCE_S2S_REALTIME = {
  model: 'gpt-realtime-mini',
  transcriptionModel: 'gpt-realtime-whisper',
  maxTokensMode: 'unlimited' as const,
  maxTokensCustom: 800,
  voice: 'coral',
  noiseReduction: 'far_field' as const,
  turnDetectionMode: 'normal' as const,
  turnDetectionThreshold: 0.5,
  turnDetectionPrefixPaddingMs: 300,
  turnDetectionSilenceDurationMs: 500,
  turnDetectionEagerness: 'medium' as const,
  idleTimeoutEnabled: false,
  estimatedCostInrPerMin: '₹2–3.5',
} as const;

const OPENAI_MODEL_VALUES = new Set<string>(REALTIME_S2S_MODEL_OPTIONS.map((o) => o.value));
const GEMINI_MODEL_VALUES = new Set<string>(GEMINI_LIVE_MODEL_OPTIONS.map((o) => o.value));
const TRANSCRIPTION_VALUES = new Set<string>(REALTIME_S2S_TRANSCRIPTION_OPTIONS.map((o) => o.value));

export function resolveS2sProvider(
  raw?: Partial<RealtimeS2sUserConfig> | null,
  pipeline?: VoicePipeline | null,
): S2sProvider {
  if (pipeline === 'gemini_live') return 'gemini';
  if (pipeline === 'openai_realtime') return 'openai';
  if (raw?.provider === 'gemini') return 'gemini';
  if (raw?.provider === 'openai') return 'openai';
  if (typeof raw?.model === 'string' && GEMINI_MODEL_VALUES.has(raw.model)) return 'gemini';
  return 'openai';
}

export function defaultGeminiLiveS2sUserConfig(): RealtimeS2sUserConfig {
  return {
    provider: 'gemini',
    model: DEFAULT_GEMINI_LIVE_MODEL,
    languageCode: DEFAULT_GEMINI_LIVE_LANGUAGE,
    transcriptionModel: SIMULATOR_FORCE_S2S_REALTIME.transcriptionModel,
    maxTokensMode: 'unlimited',
    maxTokensCustom: SIMULATOR_FORCE_S2S_REALTIME.maxTokensCustom,
    voice: DEFAULT_GEMINI_LIVE_VOICE,
    noiseReduction: 'off',
    turnDetectionMode: 'normal',
    turnDetectionThreshold: 0.5,
    // Phone/Live latency: short end-of-utterance wait (phone clamps further for 2.5).
    turnDetectionPrefixPaddingMs: 100,
    turnDetectionSilenceDurationMs: 200,
    turnDetectionEagerness: 'medium',
    idleTimeoutEnabled: false,
  };
}

export function defaultRealtimeS2sUserConfig(provider: S2sProvider = 'openai'): RealtimeS2sUserConfig {
  if (provider === 'gemini') return defaultGeminiLiveS2sUserConfig();
  return {
    provider: 'openai',
    model: SIMULATOR_FORCE_S2S_REALTIME.model,
    languageCode: DEFAULT_GEMINI_LIVE_LANGUAGE,
    transcriptionModel: SIMULATOR_FORCE_S2S_REALTIME.transcriptionModel,
    maxTokensMode: SIMULATOR_FORCE_S2S_REALTIME.maxTokensMode,
    maxTokensCustom: SIMULATOR_FORCE_S2S_REALTIME.maxTokensCustom,
    voice: SIMULATOR_FORCE_S2S_REALTIME.voice,
    noiseReduction: SIMULATOR_FORCE_S2S_REALTIME.noiseReduction,
    turnDetectionMode: SIMULATOR_FORCE_S2S_REALTIME.turnDetectionMode,
    turnDetectionThreshold: SIMULATOR_FORCE_S2S_REALTIME.turnDetectionThreshold,
    turnDetectionPrefixPaddingMs: SIMULATOR_FORCE_S2S_REALTIME.turnDetectionPrefixPaddingMs,
    turnDetectionSilenceDurationMs: SIMULATOR_FORCE_S2S_REALTIME.turnDetectionSilenceDurationMs,
    turnDetectionEagerness: SIMULATOR_FORCE_S2S_REALTIME.turnDetectionEagerness,
    idleTimeoutEnabled: SIMULATOR_FORCE_S2S_REALTIME.idleTimeoutEnabled,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeRealtimeS2sUserConfig(
  raw?: Partial<RealtimeS2sUserConfig> | null,
  pipeline?: VoicePipeline | null,
): RealtimeS2sUserConfig {
  const provider = resolveS2sProvider(raw, pipeline);
  const defaults =
    provider === 'gemini' ? defaultGeminiLiveS2sUserConfig() : defaultRealtimeS2sUserConfig();
  const modelValues = provider === 'gemini' ? GEMINI_MODEL_VALUES : OPENAI_MODEL_VALUES;
  const model =
    typeof raw?.model === 'string'
      ? provider === 'gemini'
        ? resolveGeminiLiveModel(raw.model)
        : modelValues.has(raw.model)
          ? raw.model
          : defaults.model
      : defaults.model;
  const transcriptionModel =
    typeof raw?.transcriptionModel === 'string' && TRANSCRIPTION_VALUES.has(raw.transcriptionModel)
      ? raw.transcriptionModel
      : defaults.transcriptionModel;
  const voice =
    provider === 'gemini'
      ? resolveGeminiLiveVoice(raw?.voice ?? defaults.voice)
      : resolveRealtimeVoice(raw?.voice ?? defaults.voice);

  return {
    provider,
    model,
    languageCode: resolveGeminiLiveLanguageCode(raw?.languageCode ?? defaults.languageCode),
    transcriptionModel,
    maxTokensMode: raw?.maxTokensMode === 'custom' ? 'custom' : 'unlimited',
    maxTokensCustom: clampNumber(raw?.maxTokensCustom, 64, 16_384, defaults.maxTokensCustom),
    voice,
    noiseReduction:
      raw?.noiseReduction === 'near_field' || raw?.noiseReduction === 'off'
        ? raw.noiseReduction
        : 'far_field',
    turnDetectionMode: raw?.turnDetectionMode === 'semantic' ? 'semantic' : 'normal',
    turnDetectionThreshold: clampNumber(raw?.turnDetectionThreshold, 0, 1, defaults.turnDetectionThreshold),
    turnDetectionPrefixPaddingMs: clampNumber(
      raw?.turnDetectionPrefixPaddingMs,
      0,
      2000,
      defaults.turnDetectionPrefixPaddingMs,
    ),
    turnDetectionSilenceDurationMs: clampNumber(
      raw?.turnDetectionSilenceDurationMs,
      0,
      3000,
      defaults.turnDetectionSilenceDurationMs,
    ),
    turnDetectionEagerness:
      raw?.turnDetectionEagerness === 'auto' ||
      raw?.turnDetectionEagerness === 'low' ||
      raw?.turnDetectionEagerness === 'high'
        ? raw.turnDetectionEagerness
        : defaults.turnDetectionEagerness,
    idleTimeoutEnabled: Boolean(raw?.idleTimeoutEnabled),
  };
}

export function isRealtimeS2sPresetId(raw?: string | null): raw is RealtimeS2sPresetId {
  return raw === SIMULATOR_FORCE_S2S_PRESET_ID;
}

export function estimateRealtimeS2sCostInr(config: RealtimeS2sUserConfig): string {
  if (config.provider === 'gemini') return estimateGeminiLiveCostInr(config.model);
  if (config.model.includes('mini')) return '₹2–3.5';
  if (config.model.includes('2.1')) return '₹5–8';
  return '₹4–6';
}

export function realtimeS2sUserConfigToSessionConfig(
  config: RealtimeS2sUserConfig,
  source: RealtimeS2sSessionConfig['source'] = 'simulator_force_s2s',
  pipeline?: VoicePipeline | null,
): RealtimeS2sSessionConfig {
  const resolvedPipeline: RealtimeS2sSessionConfig['pipeline'] =
    pipeline === 'gemini_live' || pipeline === 'openai_realtime'
      ? pipeline
      : config.provider === 'gemini'
        ? 'gemini_live'
        : 'openai_realtime';
  const turnDetection: RealtimeS2sTurnDetectionConfig =
    config.turnDetectionMode === 'semantic'
      ? {
          label: 'Semantic',
          type: 'semantic_vad',
          eagerness: config.turnDetectionEagerness,
        }
      : {
          label: 'Normal',
          type: 'server_vad',
          threshold: config.turnDetectionThreshold,
          prefixPaddingMs: config.turnDetectionPrefixPaddingMs,
          silenceDurationMs: config.turnDetectionSilenceDurationMs,
        };

  return {
    source,
    presetId: source === 'simulator_force_s2s' ? SIMULATOR_FORCE_S2S_PRESET_ID : undefined,
    provider: config.provider,
    pipeline: resolvedPipeline,
    model: config.model,
    languageCode: config.provider === 'gemini' ? config.languageCode : undefined,
    transcriptionModel: config.transcriptionModel,
    maxResponseOutputTokens:
      config.maxTokensMode === 'custom' ? config.maxTokensCustom : 'unlimited',
    voice: config.voice,
    noiseReduction: config.noiseReduction,
    turnDetection,
    idleTimeout: config.idleTimeoutEnabled,
    modalities: ['text', 'audio'],
    estimatedCostInrPerMin: estimateRealtimeS2sCostInr(config),
  };
}

function buildStudioDefaultConfig(voice: string): RealtimeS2sSessionConfig {
  return realtimeS2sUserConfigToSessionConfig(
    normalizeRealtimeS2sUserConfig({
      model: 'gpt-realtime',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      voice,
      turnDetectionMode: 'semantic',
      turnDetectionEagerness: 'medium',
      noiseReduction: 'off',
    }),
    'studio_default',
  );
}

/** @deprecated Use realtimeS2sUserConfigToSessionConfig with explicit user config. */
export function buildRealtimeS2sSessionConfig(
  voice?: string | null,
  presetId?: string | null,
  userConfig?: Partial<RealtimeS2sUserConfig> | null,
): RealtimeS2sSessionConfig {
  if (userConfig) {
    return realtimeS2sUserConfigToSessionConfig(
      normalizeRealtimeS2sUserConfig({ ...userConfig, voice: voice ?? userConfig.voice }),
    );
  }
  const resolvedVoice = resolveRealtimeVoice(voice ?? SIMULATOR_FORCE_S2S_REALTIME.voice);
  if (isRealtimeS2sPresetId(presetId)) {
    return realtimeS2sUserConfigToSessionConfig(
      normalizeRealtimeS2sUserConfig({ voice: resolvedVoice }),
    );
  }
  return buildStudioDefaultConfig(resolvedVoice);
}
