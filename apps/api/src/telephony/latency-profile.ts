export type TelephonyLatencyProfile = 'low' | 'balanced' | 'stable';

export interface TelephonyLatencyTuning {
  profile: TelephonyLatencyProfile;
  sttSilenceMs: number;
  commitIncompleteMs: number;
  commitCompleteMs: number;
  commitDefaultMs: number;
  commitCapMs: number;
  speculativeStableMs: number;
  ttsLookaheadMs: number;
}

const TUNINGS: Record<TelephonyLatencyProfile, TelephonyLatencyTuning> = {
  low: {
    profile: 'low',
    sttSilenceMs: 350,
    commitIncompleteMs: 500,
    commitCompleteMs: 200,
    commitDefaultMs: 280,
    commitCapMs: 600,
    speculativeStableMs: 180,
    ttsLookaheadMs: 150,
  },
  balanced: {
    profile: 'balanced',
    sttSilenceMs: 450,
    commitIncompleteMs: 650,
    commitCompleteMs: 280,
    commitDefaultMs: 380,
    commitCapMs: 900,
    speculativeStableMs: 250,
    ttsLookaheadMs: 300,
  },
  stable: {
    profile: 'stable',
    sttSilenceMs: 550,
    commitIncompleteMs: 750,
    commitCompleteMs: 380,
    commitDefaultMs: 450,
    commitCapMs: 1000,
    speculativeStableMs: 300,
    ttsLookaheadMs: 350,
  },
};

export function getTelephonyLatencyProfile(): TelephonyLatencyProfile {
  const raw = process.env.LATENCY_PROFILE?.toLowerCase();
  if (raw === 'low' || raw === 'balanced' || raw === 'stable') return raw;
  return 'low';
}

export function getTelephonyLatencyTuning(
  profile = getTelephonyLatencyProfile(),
): TelephonyLatencyTuning {
  return TUNINGS[profile];
}

/** Sarvam/Google emit many short segment finals — allow a bit longer pause, but keep phone snappy. */
export function getSegmentedSttLatencyTuning(
  profile = getTelephonyLatencyProfile(),
): TelephonyLatencyTuning {
  const base = TUNINGS[profile];
  return {
    ...base,
    commitIncompleteMs: Math.max(base.commitIncompleteMs, 550),
    commitCompleteMs: Math.max(base.commitCompleteMs, 280),
    commitDefaultMs: Math.max(base.commitDefaultMs, 350),
    commitCapMs: Math.max(base.commitCapMs, 1100),
    speculativeStableMs: Math.max(base.speculativeStableMs, 700),
    /** Keep more audio buffered between TTS sentences — reduces audible gaps on phone. */
    ttsLookaheadMs: Math.max(base.ttsLookaheadMs, 250),
  };
}
