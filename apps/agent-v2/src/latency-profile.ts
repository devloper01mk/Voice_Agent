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

export interface AzureSttLatencyConfig {
  silenceTimeoutMs: number;
  minFinalWords: number;
  minFinalConfidence: number;
  preflightInterims: boolean;
  preflightDebounceMs: number;
}

export interface PreemptiveGenerationConfig {
  enabled: boolean;
  preemptiveTts: boolean;
  maxSpeechDuration: number;
  maxRetries: number;
}

/** Simulator 2.0 — pipeline tuning (Sarvam/Google need longer pauses than Azure). */
export function getLatencyConfig(
  sttProvider?: string,
  opts?: { telephony?: boolean },
) {
  const telephony = Boolean(opts?.telephony);
  const base = {
    endpointing: { mode: 'dynamic' as const, minDelay: 300, maxDelay: 900 },
    preemptiveGeneration: {
      enabled: true,
      preemptiveTts: true,
      maxSpeechDuration: 8_000,
      maxRetries: 3,
    } satisfies PreemptiveGenerationConfig,
    interruption: {
      // Simulator: require clearer barge so agent doesn't cut mid-sentence on noise/echo.
      // Phone: shorter sustain so mid-call barge is heard sooner.
      minDuration: telephony ? 280 : 900,
      minWords: telephony ? 0 : 2,
      falseInterruptionTimeout: telephony ? 900 : 1_500,
      resumeFalseInterruption: true,
    },
    /** AgentSession AEC warmup (ms). Default LiveKit is 3000 — feels deaf on PSTN. */
    aecWarmupDuration: telephony ? 900 : 3000,
    vad: {
      activationThreshold: telephony ? 0.55 : 0.65,
      deactivationThreshold: telephony ? 0.45 : 0.52,
      minSpeechDuration: telephony ? 120 : 180,
      minSilenceDuration: telephony ? 280 : 350,
      prefixPaddingDuration: 300,
    },
    azureStt: {
      silenceTimeoutMs: 450,
      minFinalWords: 2,
      minFinalConfidence: 0.6,
      preflightInterims: true,
      preflightDebounceMs: 300,
    },
  };

  if (sttProvider === 'sarvam' || sttProvider === 'google') {
    return {
      ...base,
      endpointing: {
        mode: 'dynamic' as const,
        minDelay: telephony ? 450 : 600,
        maxDelay: telephony ? 1100 : 1400,
      },
      preemptiveGeneration: {
        enabled: false,
        preemptiveTts: false,
        maxSpeechDuration: 8_000,
        maxRetries: 3,
      },
      vad: {
        ...base.vad,
        minSilenceDuration: telephony ? 400 : 500,
      },
    };
  }

  return base;
}
