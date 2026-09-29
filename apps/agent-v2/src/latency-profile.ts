export interface EndpointingConfig {
  mode: 'fixed' | 'dynamic';
  minDelay: number;
  maxDelay: number;
}

export interface VadLatencyConfig {
  activationThreshold: number;
  deactivationThreshold: number;
  minSpeechDuration: number;
  minSilenceDuration: number;
  prefixPaddingDuration: number;
}

export interface PreemptiveGenerationConfig {
  enabled: boolean;
  preemptiveTts: boolean;
  maxSpeechDuration: number;
  maxRetries: number;
}

/** Simulator / telephony latency tuning (Gemini Live uses interruption/AEC fields). */
export function getLatencyConfig(opts?: { telephony?: boolean }) {
  const telephony = Boolean(opts?.telephony);
  return {
    endpointing: { mode: 'dynamic' as const, minDelay: 300, maxDelay: 900 },
    preemptiveGeneration: {
      enabled: true,
      preemptiveTts: true,
      maxSpeechDuration: 8_000,
      maxRetries: 3,
    } satisfies PreemptiveGenerationConfig,
    interruption: {
      // Phone echo and one-syllable noise must not count as the caller talking.
      minDuration: telephony ? 700 : 900,
      minWords: telephony ? 2 : 2,
      falseInterruptionTimeout: telephony ? 900 : 1_500,
      resumeFalseInterruption: true,
    },
    /** While the agent speaks, drop mic audio so the greeting's echo is not a caller turn. */
    aecWarmupDuration: telephony ? 2_000 : 3000,
    vad: {
      activationThreshold: telephony ? 0.55 : 0.65,
      deactivationThreshold: telephony ? 0.45 : 0.52,
      minSpeechDuration: telephony ? 120 : 180,
      minSilenceDuration: telephony ? 280 : 350,
      prefixPaddingDuration: 300,
    },
  };
}
