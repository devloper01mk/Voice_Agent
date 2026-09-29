import { normalizeVoicePipeline } from '@vsa/shared';
import type { RealtimeS2sUserConfig } from '@vsa/shared';

/** Per-call telephony session overrides (stored on Call.transcript). */
export type TelephonyPipelineMode = 'agent' | 'gemini_live';

export type TelephonyAppliedPipeline = 'gemini_live';

export type TelephonyCallSessionPayload = {
  pipelineMode: TelephonyPipelineMode;
  appliedPipeline: TelephonyAppliedPipeline;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
};

export function readTelephonySessionPayload(transcript: unknown): TelephonyCallSessionPayload | null {
  if (!transcript || typeof transcript !== 'object') return null;
  const session = (transcript as { telephonySession?: TelephonyCallSessionPayload }).telephonySession;
  if (!session || typeof session !== 'object') return null;
  return session;
}

export function normalizeTelephonyPipelineMode(raw?: string | null): TelephonyPipelineMode {
  if (raw === 'gemini_live') return 'gemini_live';
  // Legacy cascaded / openai_realtime / agent → honor agent studio (always Gemini after removal)
  return 'agent';
}

export function resolveTelephonyAppliedPipeline(
  _pipelineMode: TelephonyPipelineMode,
  _agentVoicePipeline?: string | null,
): TelephonyAppliedPipeline {
  void normalizeVoicePipeline(_agentVoicePipeline);
  return 'gemini_live';
}
