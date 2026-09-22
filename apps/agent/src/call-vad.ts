import { inference } from '@livekit/agents';
import { type VadLatencyConfig, getLatencyConfig } from './latency-profile.js';

/** Silero VAD tuned for call latency profile. */
export function createCallVad(config?: VadLatencyConfig) {
  const vad = config ?? getLatencyConfig().vad;
  return new inference.VAD({
    model: 'silero',
    activationThreshold: vad.activationThreshold,
    deactivationThreshold: vad.deactivationThreshold,
    minSpeechDuration: vad.minSpeechDuration,
    minSilenceDuration: vad.minSilenceDuration,
    prefixPaddingDuration: vad.prefixPaddingDuration,
  });
}
