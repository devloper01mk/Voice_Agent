import { isGeminiLivePipeline, isS2sPipeline, normalizeVoicePipeline } from '@vsa/shared';
import type { RealtimeS2sUserConfig } from '@vsa/shared';

/** Per-call telephony session overrides (stored on Call.transcript). */
export type TelephonyPipelineMode = 'agent' | 'cascaded' | 'openai_realtime' | 'gemini_live';

export type TelephonyAppliedPipeline = 'cascaded' | 'openai_realtime' | 'gemini_live';

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
  if (raw === 'cascaded') return 'cascaded';
  if (raw === 'openai_realtime') return 'openai_realtime';
  if (raw === 'gemini_live') return 'gemini_live';
  return 'agent';
}

export function resolveTelephonyAppliedPipeline(
  pipelineMode: TelephonyPipelineMode,
  agentVoicePipeline?: string | null,
): TelephonyAppliedPipeline {
  if (pipelineMode === 'openai_realtime') return 'openai_realtime';
  if (pipelineMode === 'gemini_live') return 'gemini_live';
  if (pipelineMode === 'cascaded') return 'cascaded';
  const agentPipeline = normalizeVoicePipeline(agentVoicePipeline);
  if (isS2sPipeline(agentPipeline)) return agentPipeline;
  return 'cascaded';
}

export function isTelephonyS2sPipeline(raw?: string | null): boolean {
  return isS2sPipeline(raw);
}

export function isTelephonyGeminiLivePipeline(raw?: string | null): boolean {
  return isGeminiLivePipeline(raw);
}
