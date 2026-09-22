export type LatencyProfile = 'low' | 'balanced' | 'stable';

export function getLatencyProfile(): LatencyProfile {
  const raw = process.env.LATENCY_PROFILE?.toLowerCase();
  if (raw === 'low' || raw === 'balanced' || raw === 'stable') return raw;
  return 'balanced';
}

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
}

const PROFILES: Record<
  LatencyProfile,
  {
    endpointing: EndpointingConfig;
    preemptiveGeneration: boolean;
    interruption: { minDuration: number; minWords: number };
    vad: VadLatencyConfig;
    azureStt: AzureSttLatencyConfig;
  }
> = {
  low: {
    endpointing: { mode: 'dynamic', minDelay: 400, maxDelay: 1200 },
    preemptiveGeneration: true,
    interruption: { minDuration: 900, minWords: 2 },
    vad: {
      activationThreshold: 0.65,
      deactivationThreshold: 0.52,
      minSpeechDuration: 180,
      minSilenceDuration: 400,
      prefixPaddingDuration: 300,
    },
    azureStt: { silenceTimeoutMs: 800, minFinalWords: 2, minFinalConfidence: 0.65 },
  },
  balanced: {
    endpointing: { mode: 'dynamic', minDelay: 350, maxDelay: 1500 },
    preemptiveGeneration: true,
    interruption: { minDuration: 1000, minWords: 2 },
    vad: {
      activationThreshold: 0.65,
      deactivationThreshold: 0.52,
      minSpeechDuration: 180,
      minSilenceDuration: 350,
      prefixPaddingDuration: 300,
    },
    azureStt: { silenceTimeoutMs: 500, minFinalWords: 2, minFinalConfidence: 0.65 },
  },
  stable: {
    endpointing: { mode: 'fixed', minDelay: 450, maxDelay: 1800 },
    preemptiveGeneration: false,
    interruption: { minDuration: 1200, minWords: 3 },
    vad: {
      activationThreshold: 0.72,
      deactivationThreshold: 0.52,
      minSpeechDuration: 180,
      minSilenceDuration: 400,
      prefixPaddingDuration: 300,
    },
    azureStt: { silenceTimeoutMs: 700, minFinalWords: 2, minFinalConfidence: 0.65 },
  },
};

export function getLatencyConfig(profile = getLatencyProfile()) {
  return PROFILES[profile];
}
