import type { CallDirection, KnownContactProfile, SkillsConfig } from '@vsa/shared';

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
}

export interface RuntimeFetchOptions {
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
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
  const res = await fetch(`${apiUrl}/api/agents/${agentId}/runtime${qs}`);
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
  const fromRoomName = roomName.match(/^call-([0-9a-f-]{36})-/i)?.[1];
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
  return { agent, callId, direction, prospectName, contactPhone, contactEmail };
}
