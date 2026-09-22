import type { RealtimeS2sUserConfig, SkillsConfig, SttProvider, VoicePipeline } from '@vsa/shared';
import { normalizeRealtimeS2sUserConfig } from '@vsa/shared';

const API = '/api';

export interface Agent {
  id: string;
  name: string;
  greeting: string;
  persona: string;
  productName: string;
  voiceId: string;
  voiceLanguage: string;
  voiceLanguages: string;
  voiceSpeed: number;
  voicePitch: number;
  ttsModel: string;
  ttsSampleRate?: number;
  ttsEmotion?: string;
  voicePipeline?: VoicePipeline;
  realtimeVoice?: string;
  /** Persisted OpenAI Realtime / Gemini Live S2S settings (model, VAD, language…). */
  realtimeS2sConfig?: RealtimeS2sUserConfig | null;
  agentGender: 'female' | 'male';
  llmProvider: 'groq' | 'gpt';
  llmModel: string;
  sttProvider: SttProvider;
  sttModel: string;
  brainMarkdown: string;
  brainSummary?: string;
  brainLearnings?: string;
  learningsEnabled?: boolean;
  generalKnowledgeEnabled?: boolean;
  skillsConfig: SkillsConfig;
  compiledSystemPrompt?: string;
  promptTokenCount?: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  productName: string;
  llmProvider: string;
  llmModel: string;
  sttProvider?: string;
  sttModel?: string;
  voicePipeline?: string;
  realtimeVoice?: string;
  realtimeS2sConfig?: RealtimeS2sUserConfig | null;
  voiceId: string;
  promptTokenCount: number;
  generalKnowledgeEnabled?: boolean;
  /** From Studio booking policy — stay agents should use LiveKit SIP. */
  bookingOutcome?: 'demo' | 'visit' | 'stay' | 'callback' | 'lead_only';
  updatedAt: string;
}

export async function listAgents(): Promise<AgentSummary[]> {
  const res = await fetch(`${API}/agents`);
  if (!res.ok) throw new Error('Failed to list agents');
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error('Failed to list agents');
  return data as AgentSummary[];
}

export async function getAgent(id: string): Promise<Agent> {
  const res = await fetch(`${API}/agents/${id}`);
  if (!res.ok) throw new Error('Agent not found');
  return res.json();
}

export async function createAgent(data: Partial<Agent>): Promise<Agent> {
  const res = await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to create agent'));
  }
  return res.json();
}

export async function updateAgent(id: string, data: Partial<Agent>): Promise<Agent> {
  const res = await fetch(`${API}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to update agent'));
  }
  return res.json();
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') return `${fallback} (${res.status})`;
  const err = body as {
    error?: string;
    formErrors?: string[];
    fieldErrors?: Record<string, string[] | undefined>;
  };
  if (typeof err.error === 'string' && err.error.trim()) return err.error;
  const fieldMessages = Object.entries(err.fieldErrors ?? {})
    .flatMap(([key, msgs]) => (msgs ?? []).map((m) => `${key}: ${m}`));
  const formMessages = err.formErrors ?? [];
  const detail = [...formMessages, ...fieldMessages].join('; ');
  if (detail) return detail;
  return `${fallback} (${res.status})`;
}

export async function getLiveKitToken(
  agentId: string,
  options?: {
    participantName?: string;
    direction?: 'inbound' | 'outbound';
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
  },
) {
  const res = await fetch(`${API}/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId,
      participantName: options?.participantName,
      direction: options?.direction ?? 'inbound',
      prospectName: options?.prospectName,
      contactPhone: options?.contactPhone,
      contactEmail: options?.contactEmail,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Failed to get LiveKit token (${res.status})`);
  }
  return res.json() as Promise<{
    token: string;
    url: string;
    roomName: string;
    callId: string;
  }>;
}

export async function getSimulator2Token(
  agentId: string,
  options?: {
    participantName?: string;
    direction?: 'inbound' | 'outbound';
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
    voicePipeline?: VoicePipeline;
    realtimeVoice?: string;
    realtimeS2sConfig?: RealtimeS2sUserConfig;
  },
) {
  const res = await fetch(`${API}/simulator2/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId,
      participantName: options?.participantName,
      direction: options?.direction ?? 'inbound',
      prospectName: options?.prospectName,
      contactPhone: options?.contactPhone,
      contactEmail: options?.contactEmail,
      voicePipeline: options?.voicePipeline,
      realtimeVoice: options?.realtimeVoice,
      realtimeS2sConfig: options?.realtimeS2sConfig
        ? normalizeRealtimeS2sUserConfig(options.realtimeS2sConfig)
        : undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to get Simulator 2.0 token'));
  }
  return res.json() as Promise<{
    token: string;
    url: string;
    roomName: string;
    callId: string;
    voicePipeline?: VoicePipeline;
    realtimeVoice?: string;
    realtimeS2sConfig?: RealtimeS2sUserConfig;
  }>;
}

export interface TranscriptLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  isFinal?: boolean;
  timestamp: number;
}

export interface CallMetricsSummary {
  callDurationSec: number;
  userTurns: number;
  agentTurns: number;
  lastSttMs?: number;
  lastLlmTtftMs?: number;
  lastTtsTtfbMs?: number;
  lastEouDelayMs?: number;
  lastE2eMs?: number;
  lastResponseLatencyMs?: number;
  avgResponseLatencyMs?: number;
  responseLatencySamples?: number;
  lastFeltResponseMs?: number;
  avgFeltResponseMs?: number;
  feltResponseSamples?: number;
  /** Bundled per-turn latency from agent-v2 turn_metrics telemetry. */
  lastTurnBundled?: boolean;
  totalLlmTokens?: number;
  totalSttAudioDurationMs?: number;
  totalLlmPromptTokens?: number;
  totalLlmCachedPromptTokens?: number;
  totalLlmCompletionTokens?: number;
  totalTtsCharacters?: number;
  /** Speech-to-speech (OpenAI Realtime / Gemini Live) token usage. */
  totalS2sInputTextTokens?: number;
  totalS2sInputAudioTokens?: number;
  totalS2sOutputTextTokens?: number;
  totalS2sOutputAudioTokens?: number;
  totalS2sTokens?: number;
}

export async function saveCallSummary(
  callId: string,
  data: { transcript: TranscriptLine[]; metrics: CallMetricsSummary; outcome?: string },
) {
  const res = await fetch(`${API}/calls/${callId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: { lines: data.transcript, metrics: data.metrics },
      outcome: data.outcome ?? 'completed',
    }),
  });
  if (!res.ok) throw new Error('Failed to save call summary');
  return res.json();
}

export interface CartesiaVoice {
  id: string;
  name: string;
  description: string;
  language: string;
  gender: string;
  isPublic: boolean;
}

export interface CartesiaLanguage {
  code: string;
  label: string;
}

export interface TtsModel {
  id: string;
  label: string;
}

export interface TtsSampleRate {
  id: number;
  label: string;
}

export interface TtsEmotion {
  id: string;
  label: string;
}

export async function listTtsModels(): Promise<TtsModel[]> {
  const res = await fetch(`${API}/tts/models`);
  if (!res.ok) throw new Error('Failed to load TTS models');
  return res.json();
}

export async function listTtsSampleRates(): Promise<TtsSampleRate[]> {
  const res = await fetch(`${API}/tts/sample-rates`);
  if (!res.ok) throw new Error('Failed to load sample rates');
  return res.json();
}

export async function listTtsEmotions(): Promise<TtsEmotion[]> {
  const res = await fetch(`${API}/tts/emotions`);
  if (!res.ok) throw new Error('Failed to load emotions');
  return res.json();
}

export async function listTtsLanguages(): Promise<CartesiaLanguage[]> {
  const res = await fetch(`${API}/tts/languages`);
  if (!res.ok) throw new Error('Failed to load languages');
  return res.json();
}

export async function listTtsVoices(): Promise<CartesiaVoice[]> {
  const res = await fetch(`${API}/tts/voices`);
  if (!res.ok) throw new Error('Failed to load voices');
  return res.json();
}

export async function previewTts(
  text: string,
  voiceId: string,
  speed = 1,
  pitch = 1,
  voiceLanguages = 'en,hi,hinglish',
  modelId = 'sonic-3.6',
  sampleRate = 24000,
  emotion = '',
) {
  const res = await fetch(`${API}/tts/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceId,
      speed,
      pitch,
      voiceLanguages,
      modelId,
      sampleRate,
      emotion,
    }),
  });
  if (!res.ok) throw new Error('TTS preview failed');
  return res.blob();
}

export interface BrainMutation {
  id: string;
  agentId: string;
  callId?: string | null;
  kind: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface ProspectMemory {
  id: string;
  agentId: string;
  prospectKey: string;
  displayName?: string | null;
  factsMarkdown: string;
  callerStyle: string;
  lastCallId?: string | null;
  updatedAt: string;
}

export async function getGlobalLearningStats(
  agentId: string,
): Promise<{ vectorCount: number; textLineCount: number }> {
  const res = await fetch(`${API}/agents/${agentId}/learning-stats`);
  if (!res.ok) throw new Error('Failed to load learning stats');
  return res.json();
}

export async function listMutations(
  agentId: string,
  options?: { status?: string; limit?: number },
): Promise<BrainMutation[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.limit) params.set('limit', String(options.limit));
  const qs = params.toString();
  const res = await fetch(`${API}/agents/${agentId}/mutations${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to load mutations');
  return res.json();
}

export async function listPendingMutations(agentId: string): Promise<BrainMutation[]> {
  return listMutations(agentId, { status: 'held' });
}

export async function listLearningAudit(agentId: string): Promise<BrainMutation[]> {
  return listMutations(agentId, { limit: 40 });
}

export async function clearBrainLearnings(agentId: string): Promise<void> {
  const res = await fetch(`${API}/agents/${agentId}/mutations/clear-learnings`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to clear learnings');
}

export async function approveMutation(agentId: string, mutationId: string): Promise<void> {
  const res = await fetch(`${API}/agents/${agentId}/mutations/${mutationId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to approve mutation');
}

export async function rejectMutation(agentId: string, mutationId: string): Promise<void> {
  const res = await fetch(`${API}/agents/${agentId}/mutations/${mutationId}/reject`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reject mutation');
}

export async function listProspectMemories(agentId: string): Promise<ProspectMemory[]> {
  const res = await fetch(`${API}/agents/${agentId}/prospects`);
  if (!res.ok) throw new Error('Failed to load prospect memories');
  return res.json();
}

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  preferredTime: string;
  preferredTimeRaw?: string;
  notes?: string | null;
  bookingType: string;
  status: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  productInterest?: string | null;
  location?: string | null;
  source?: string;
  googleEventId?: string | null;
  calendarSyncStatus?: string;
  createdAt: string;
  updatedAt?: string;
  call?: {
    id: string;
    direction: string;
    startedAt: string;
    outcome?: string | null;
  } | null;
}

export interface CallbackRow {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  preferredTime: string;
  reason?: string | null;
  status: string;
  scheduledAt?: string | null;
  createdAt: string;
}

export async function listLeads(
  agentId: string,
  options?: { from?: string; to?: string; status?: string; source?: string },
): Promise<{ leads: LeadRow[]; callbacks: CallbackRow[] }> {
  const params = new URLSearchParams();
  if (options?.from) params.set('from', options.from);
  if (options?.to) params.set('to', options.to);
  if (options?.status) params.set('status', options.status);
  if (options?.source) params.set('source', options.source);
  const qs = params.toString();
  const res = await fetch(`${API}/leads/agent/${agentId}${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to load leads');
  return res.json();
}

export async function createLead(data: {
  agentId: string;
  name: string;
  email?: string;
  phone?: string;
  preferredTime?: string;
  notes?: string;
  bookingType?: string;
  productInterest?: string;
  source?: string;
  skipAvailabilityCheck?: boolean;
}): Promise<LeadRow> {
  const res = await fetch(`${API}/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string; hint?: string }).error ||
        (body as { hint?: string }).hint ||
        'Failed to create lead',
    );
  }
  return res.json();
}

export async function updateLead(
  id: string,
  data: Partial<{
    status: string;
    preferredTime: string;
    notes: string;
    bookingType: string;
    forceBook: boolean;
  }>,
): Promise<LeadRow> {
  const res = await fetch(`${API}/leads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Failed to update lead');
  }
  return res.json();
}

export interface CallListItem {
  id: string;
  agentId: string;
  agentName: string;
  direction: string;
  prospectName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  outcome?: string | null;
  startedAt: string;
  endedAt?: string | null;
  hasTranscript: boolean;
  leads: {
    id: string;
    name: string;
    bookingType: string;
    status: string;
    scheduledStart?: string | null;
  }[];
  callbacks: {
    id: string;
    preferredTime: string;
    status: string;
    scheduledAt?: string | null;
  }[];
}

export async function listCalls(
  agentId: string,
  options?: { direction?: 'inbound' | 'outbound'; take?: number },
): Promise<CallListItem[]> {
  const params = new URLSearchParams({ agentId });
  if (options?.direction) params.set('direction', options.direction);
  if (options?.take) params.set('take', String(options.take));
  const res = await fetch(`${API}/calls?${params}`);
  if (!res.ok) throw new Error('Failed to load calls');
  const data = (await res.json()) as { calls: CallListItem[] };
  return data.calls;
}

export async function getCall(id: string) {
  const res = await fetch(`${API}/calls/${id}`);
  if (!res.ok) throw new Error('Call not found');
  return res.json() as Promise<{
    id: string;
    status?: string;
    direction?: string;
    source?: string;
    toNumber?: string | null;
    fromNumber?: string | null;
    startedAt?: string;
    outcome?: string | null;
    endedAt?: string | null;
    transcript?:
      | {
          lines?: TranscriptLine[];
          metrics?: CallMetricsSummary;
        }
      | TranscriptLine[];
    prospectName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    agent?: { id: string; name: string };
  }>;
}

export type TelephonyTransports = {
  acefone: boolean;
  /** True when Acefone keys exist even if SIP is preferred (Acefone option hidden while SIP is up). */
  acefoneConfigured?: boolean;
  livekit_sip: boolean;
  livekitSipError: string | null;
  recommended: 'acefone' | 'livekit_sip';
  reason?: string;
  defaultTransport?: 'acefone' | 'livekit_sip';
  acefoneDetail?: {
    configured: boolean;
    recommended: boolean;
    reason: string;
  };
  livekitSipDetail?: {
    configured: boolean;
    recommended: boolean;
    reason: string;
    trunkIdPresent: boolean;
    requiresAgentV2: boolean;
  };
};

export async function getTelephonyTransports(): Promise<TelephonyTransports> {
  const res = await fetch(`${API}/telephony/transports`);
  if (!res.ok) {
    return {
      acefone: true,
      livekit_sip: false,
      livekitSipError: 'Failed to load transports',
      recommended: 'acefone',
      defaultTransport: 'acefone',
      reason: 'Could not reach telephony transports API.',
    };
  }
  return res.json();
}

export async function initiateOutboundCall(options: {
  agentId: string;
  toNumber: string;
  prospectName?: string;
  contactEmail?: string;
  voicePipeline?: 'agent' | 'cascaded' | 'openai_realtime' | 'gemini_live';
  realtimeS2sConfig?: RealtimeS2sUserConfig;
  transport?: 'acefone' | 'livekit_sip';
  waitUntilAnswered?: boolean;
  useDefaultTrunkCallerId?: boolean;
  playDialtone?: boolean;
}): Promise<{
  callId: string;
  status: string;
  message?: string;
  voicePipeline?: string;
  pipelineMode?: string;
  transport?: string;
  provider?: string;
  roomName?: string;
  selectedPath?: 'acefone_support_api' | 'livekit_sip';
  debugMessage?: string;
  waitUntilAnswered?: boolean;
  useDefaultTrunkCallerId?: boolean;
  playDialtone?: boolean;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
}> {
  const res = await fetch(`${API}/telephony/outbound-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...options,
      realtimeS2sConfig: options.realtimeS2sConfig
        ? normalizeRealtimeS2sUserConfig(options.realtimeS2sConfig)
        : undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to place outbound call'));
  }
  return res.json();
}

export async function hangupOutboundCall(callId: string): Promise<{ ok: boolean; callId: string }> {
  const res = await fetch(`${API}/telephony/calls/${callId}/hangup`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, 'Failed to hang up call'));
  }
  return res.json();
}

export interface MonthDaySummary {
  date: string;
  weekdayIndex: number;
  isOpen: boolean;
  bookingCount: number;
  freeSlotCount: number;
  hasAvailability: boolean;
}

export async function getCalendarMonth(
  agentId: string,
  year: number,
  month: number,
): Promise<{
  year: number;
  month: number;
  timezone: string;
  days: MonthDaySummary[];
  calendarEnabled?: boolean;
  bookingWindow?: string;
}> {
  const params = new URLSearchParams({
    agentId,
    year: String(year),
    month: String(month),
  });
  const res = await fetch(`${API}/calendar/month?${params}`);
  if (!res.ok) throw new Error('Failed to load calendar month');
  return res.json();
}

export interface DaySlot {
  start: string;
  end: string;
  status: 'booked' | 'free' | 'full';
  remainingCapacity: number;
  bookings: { id: string; name?: string; bookingType?: string; status?: string }[];
}

export async function getCalendarDay(
  agentId: string,
  date: string,
): Promise<{ date: string; timezone: string; slots: DaySlot[] }> {
  const params = new URLSearchParams({ agentId, date });
  const res = await fetch(`${API}/calendar/day?${params}`);
  if (!res.ok) throw new Error('Failed to load calendar day');
  return res.json();
}

export type AgentAvailabilityConfig = {
  enabled: boolean;
  timezone?: string;
  openDays: number[];
  dayStartHour: number;
  dayStartMinute: number;
  dayEndHour: number;
  dayEndMinute: number;
  slotMinutes: number;
  capacityPerSlot: number;
  blockedDates: string[];
  slotMinutesByType?: Record<string, number>;
};

export async function getAgentAvailability(agentId: string): Promise<{
  config: AgentAvailabilityConfig;
  stored: unknown;
  bookingWindow: string;
}> {
  const res = await fetch(`${API}/calendar/availability/${agentId}`);
  if (!res.ok) throw new Error(await readApiError(res, 'Failed to load availability'));
  return res.json();
}

export async function saveAgentAvailability(
  agentId: string,
  data: Partial<AgentAvailabilityConfig> & { enabled?: boolean },
): Promise<{
  config: AgentAvailabilityConfig;
  bookingWindow: string;
}> {
  const res = await fetch(`${API}/calendar/availability/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await readApiError(res, 'Failed to save availability'));
  return res.json();
}

