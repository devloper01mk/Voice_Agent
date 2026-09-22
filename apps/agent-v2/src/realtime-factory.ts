import * as openai from '@livekit/agents-plugin-openai';
import {
  REALTIME_S2S_TRANSCRIPTION_PROMPT,
  normalizeRealtimeS2sUserConfig,
  resolveRealtimeVoice,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';

export function createRealtimeModel(opts?: {
  voice?: string | null;
  model?: string | null;
  speed?: number;
  s2sConfig?: Partial<RealtimeS2sUserConfig> | null;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for Simulator 2.0 openai_realtime voice pipeline',
    );
  }

  const config = opts?.s2sConfig ? normalizeRealtimeS2sUserConfig(opts.s2sConfig) : null;
  const voice = resolveRealtimeVoice(config?.voice ?? opts?.voice);

  const turnDetection =
    config?.turnDetectionMode === 'semantic'
      ? {
          type: 'semantic_vad' as const,
          eagerness: config.turnDetectionEagerness,
          create_response: true,
          interrupt_response: true,
        }
      : config
        ? {
            type: 'server_vad' as const,
            threshold: config.turnDetectionThreshold,
            prefix_padding_ms: config.turnDetectionPrefixPaddingMs,
            silence_duration_ms: config.turnDetectionSilenceDurationMs,
            create_response: true,
            interrupt_response: true,
          }
        : {
            type: 'semantic_vad' as const,
            eagerness: 'medium' as const,
            create_response: true,
            interrupt_response: true,
          };

  const noiseReduction =
    config && config.noiseReduction !== 'off'
      ? { type: config.noiseReduction }
      : undefined;

  console.info(
    `[vsa] OpenAI Realtime S2S: model=${config?.model ?? opts?.model ?? 'gpt-realtime'} voice=${voice}`,
  );

  return new openai.realtime.RealtimeModel({
    apiKey,
    model:
      config?.model ||
      opts?.model?.trim() ||
      process.env.OPENAI_REALTIME_MODEL ||
      'gpt-realtime',
    voice,
    modalities: ['text', 'audio'],
    speed: typeof opts?.speed === 'number' ? opts.speed : undefined,
    inputAudioNoiseReduction: noiseReduction,
    turnDetection,
    inputAudioTranscription: config
      ? {
          model: config.transcriptionModel,
          prompt: REALTIME_S2S_TRANSCRIPTION_PROMPT,
        }
      : {
          model: 'gpt-4o-mini-transcribe',
          prompt: REALTIME_S2S_TRANSCRIPTION_PROMPT,
        },
  });
}
