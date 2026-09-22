import {
  isS2sPipeline,
  normalizeVoicePipeline,
  normalizeRealtimeS2sUserConfig,
  resolveRealtimeVoice,
  type CallDirection,
  type KnownContactProfile,
  type RealtimeS2sUserConfig,
  type SkillsConfig,
} from '@vsa/shared';

export interface RuntimeAgent {
  id: string;
  name: string;
  greeting: string;
  productName: string;
  voiceId: string;
  voiceLanguage: string;
  voiceLanguages: string;
  voiceSpeed: number;
  voicePitch: number;
  ttsModel: string;
  ttsSampleRate?: number;
  ttsEmotion?: string;
  voicePipeline?: string;
  realtimeVoice?: string;
  realtimeS2sPreset?: string;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
  agentGender: string;
  llmProvider: string;
  llmModel: string;
  sttProvider?: string;
  sttModel?: string;
  compiledSystemPrompt: string;
  brainSummary?: string;
  generalKnowledgeEnabled?: boolean;
  skillsConfig?: SkillsConfig;
  brainLearnings?: string;
  retrievedGlobalLearnings?: string;
  knownContact?: KnownContactProfile;
  openBookingSummary?: string | null;
  hasConsumedLeadHistory?: boolean;
  prospectMemory?: {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    factsMarkdown?: string;
    callerStyle?: string;
  } | null;
}

export interface RoomMetadata {
  agentId?: string;
  callId?: string;
  direction?: CallDirection;
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
  simulatorVersion?: string;
  /** Simulator-only session override — telephony ignores this. */
  voicePipeline?: string;
  realtimeVoice?: string;
  /** Simulator Force S2S preset — applies budget realtime config. */
  realtimeS2sPreset?: string;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
  /** Flat fallback when nested realtimeS2sConfig is unavailable in metadata. */
  s2sVoice?: string;
  s2sModel?: string;
}

export interface RuntimeFetchOptions {
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

const RUNTIME_PATH = '/api/simulator2/agents';
const SESSION_CONFIG_PATH = '/api/simulator2/calls';

async function fetchCallSessionConfig(
  callId: string,
): Promise<{
  voicePipeline?: string;
  realtimeVoice?: string;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
} | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiUrl}${SESSION_CONFIG_PATH}/${callId}/session-config`);
    if (!res.ok) return null;
    return (await res.json()) as {
      voicePipeline?: string;
      realtimeVoice?: string;
      realtimeS2sConfig?: RealtimeS2sUserConfig;
    };
  } catch {
    return null;
  }
}

export async function fetchRuntimeAgent(
  agentId: string,
  options?: RuntimeFetchOptions,
): Promise<RuntimeAgent> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
  const params = new URLSearchParams();
  if (options?.prospectName?.trim()) params.set('prospectName', options.prospectName.trim());
  if (options?.contactPhone?.trim()) params.set('contactPhone', options.contactPhone.trim());
  if (options?.contactEmail?.trim()) params.set('contactEmail', options.contactEmail.trim());
  const qs = params.size ? `?${params.toString()}` : '';
  const res = await fetch(`${apiUrl}${RUNTIME_PATH}/${agentId}/runtime${qs}`);
  if (!res.ok) {
    throw new Error(`Failed to load agent ${agentId}: ${res.status}`);
  }
  return res.json() as Promise<RuntimeAgent>;
}

export function parseRoomMetadata(raw?: string): RoomMetadata {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as RoomMetadata;
  } catch {
    return {};
  }
}

export async function resolveAgentFromRoom(
  roomName: string,
  roomMetadata?: string,
  participantMetadata?: string,
): Promise<{
  agent: RuntimeAgent;
  callId?: string;
  direction: CallDirection;
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
}> {
  const room = parseRoomMetadata(roomMetadata);
  const participant = parseRoomMetadata(participantMetadata);

  const fromMeta = participant.agentId ?? room.agentId;
  const fromRoomName =
    roomName.match(/^call-v2-([0-9a-f-]{36})-/i)?.[1] ??
    roomName.match(/^call-([0-9a-f-]{36})-/i)?.[1];
  const agentId = fromMeta ?? fromRoomName;
  const callId = participant.callId ?? room.callId;
  const direction = participant.direction ?? room.direction ?? 'inbound';
  const prospectName = participant.prospectName ?? room.prospectName;
  const contactPhone = participant.contactPhone ?? room.contactPhone;
  const contactEmail = participant.contactEmail ?? room.contactEmail;

  if (!agentId) {
    throw new Error('No agentId in room name or metadata');
  }

  const agent = await fetchRuntimeAgent(agentId, {
    prospectName,
    contactPhone,
    contactEmail,
  });

  const pipelineOverride = participant.voicePipeline ?? room.voicePipeline;
  if (pipelineOverride) {
    agent.voicePipeline = normalizeVoicePipeline(pipelineOverride);
  }

  if (callId) {
    const sessionFromApi = await fetchCallSessionConfig(callId);
    if (sessionFromApi?.voicePipeline) {
      agent.voicePipeline = normalizeVoicePipeline(sessionFromApi.voicePipeline);
    }
    if (sessionFromApi?.realtimeS2sConfig) {
      agent.realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
        sessionFromApi.realtimeS2sConfig,
        normalizeVoicePipeline(sessionFromApi.voicePipeline ?? agent.voicePipeline),
      );
      agent.realtimeVoice = agent.realtimeS2sConfig.voice;
      console.info(
        `[vsa] S2S session from API: voice=${agent.realtimeS2sConfig.voice} model=${agent.realtimeS2sConfig.model}`,
      );
    } else if (sessionFromApi?.realtimeVoice) {
      agent.realtimeVoice = resolveRealtimeVoice(sessionFromApi.realtimeVoice);
    }
  }

  if (!agent.realtimeS2sConfig) {
    const s2sConfigOverride = participant.realtimeS2sConfig ?? room.realtimeS2sConfig;
    const flatS2sVoice = participant.s2sVoice ?? room.s2sVoice;
    if (s2sConfigOverride) {
      agent.realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
        s2sConfigOverride,
        normalizeVoicePipeline(agent.voicePipeline),
      );
      agent.realtimeVoice = agent.realtimeS2sConfig.voice;
    } else if (
      isS2sPipeline(agent.voicePipeline) &&
      typeof flatS2sVoice === 'string' &&
      flatS2sVoice.trim()
    ) {
      agent.realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
        { voice: flatS2sVoice },
        normalizeVoicePipeline(agent.voicePipeline),
      );
      agent.realtimeVoice = agent.realtimeS2sConfig.voice;
    } else {
      const voiceOverride = participant.realtimeVoice ?? room.realtimeVoice;
      if (voiceOverride) {
        agent.realtimeVoice = resolveRealtimeVoice(voiceOverride);
      }
    }
  }

  const presetOverride = participant.realtimeS2sPreset ?? room.realtimeS2sPreset;
  if (presetOverride) {
    agent.realtimeS2sPreset = presetOverride;
  }

  return { agent, callId, direction, prospectName, contactPhone, contactEmail };
}
