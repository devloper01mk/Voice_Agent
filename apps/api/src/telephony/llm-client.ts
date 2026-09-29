import {
  buildSimulator2Instructions,
  mergeSkillsConfig,
  resolveCallLlm,
  type CallDirection,
  type KnownContactProfile,
  type SkillsConfig,
} from '@vsa/shared';
import { authHeadersForServerFetch } from '../auth.js';
import { internalApiUrl } from './internal-api.js';

export interface RuntimeAgentPayload {
  id: string;
  name: string;
  greeting: string;
  productName: string;
  voiceId: string;
  voiceLanguages: string;
  voiceSpeed: number;
  voicePitch: number;
  ttsModel: string;
  ttsSampleRate?: number;
  ttsEmotion?: string;
  llmProvider: string;
  llmModel: string;
  sttProvider?: string;
  sttModel?: string;
  compiledSystemPrompt: string;
  agentGender?: string;
  brainSummary?: string | null;
  generalKnowledgeEnabled?: boolean;
  brainLearnings?: string | null;
  retrievedGlobalLearnings?: string | null;
  skillsConfig?: SkillsConfig | null;
  knownContact?: KnownContactProfile | null;
  openBookingSummary?: string | null;
  hasConsumedLeadHistory?: boolean;
  prospectMemory?: {
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    factsMarkdown?: string;
    callerStyle?: string;
  } | null;
  simulatorRuntime?: {
    llmProvider?: string;
    llmModel?: string;
    studioLlmProvider?: string;
    studioLlmModel?: string;
  };
}

interface LlmEndpoint {
  label: string;
  url: string;
  apiKey: string;
  model: string;
}

const runtimePrefetch = new Map<string, Promise<RuntimeAgentPayload>>();

export function prefetchRuntimeAgent(
  callId: string,
  agentId: string,
  opts?: {
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
    direction?: CallDirection;
  },
): Promise<RuntimeAgentPayload> {
  const existing = runtimePrefetch.get(callId);
  if (existing) return existing;

  const promise = fetchRuntimeAgent(agentId, opts).catch((err) => {
    runtimePrefetch.delete(callId);
    throw err;
  });
  runtimePrefetch.set(callId, promise);
  return promise;
}

export function takePrefetchedRuntime(callId: string): Promise<RuntimeAgentPayload> | undefined {
  const promise = runtimePrefetch.get(callId);
  if (promise) runtimePrefetch.delete(callId);
  return promise;
}

export function dropPrefetchedRuntime(callId: string): void {
  runtimePrefetch.delete(callId);
}

export async function fetchRuntimeAgent(
  agentId: string,
  opts?: {
    prospectName?: string;
    contactPhone?: string;
    contactEmail?: string;
    direction?: CallDirection;
  },
): Promise<RuntimeAgentPayload> {
  const apiUrl = internalApiUrl();
  const params = new URLSearchParams();
  if (opts?.prospectName) params.set('prospectName', opts.prospectName);
  if (opts?.contactPhone) params.set('contactPhone', opts.contactPhone);
  if (opts?.contactEmail) params.set('contactEmail', opts.contactEmail);
  const qs = params.toString();
  const url = `${apiUrl}/api/simulator2/agents/${agentId}/runtime${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: authHeadersForServerFetch() });
  if (!res.ok) throw new Error(`Failed to load agent runtime (${res.status})`);
  const data = (await res.json()) as RuntimeAgentPayload;
  data.skillsConfig = mergeSkillsConfig(data.skillsConfig);
  const callLlm = resolveCallLlm(data);
  data.llmProvider = callLlm.provider;
  data.llmModel = callLlm.model;

  const { instructions, knownContact } = buildSimulator2Instructions({
    agent: data,
    direction: opts?.direction ?? 'outbound',
    prospectName: opts?.prospectName,
    contactPhone: opts?.contactPhone,
    contactEmail: opts?.contactEmail,
    skills: data.skillsConfig,
  });
  data.compiledSystemPrompt = instructions;
  data.knownContact = knownContact;
  return data;
}

export function telephonyLlmLabel(agent: RuntimeAgentPayload): string {
  const ep = resolveTelephonyLlm(agent);
  return `${ep.model} (${ep.label})`;
}

function resolveTelephonyLlm(agent: RuntimeAgentPayload): LlmEndpoint {
  const llm = resolveCallLlm(agent);
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not configured');
  return {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: openaiKey,
    model: llm.model,
  };
}
