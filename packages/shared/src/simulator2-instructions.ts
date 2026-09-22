import {
  buildCallerContextPrompt,
  buildDemoKnownContactRules,
  mergeKnownContact,
  type CallDirection,
  type KnownContactProfile,
} from './known-contact.js';
import {
  buildCallerStylePrompt,
  buildLearningsPrompt,
  buildProspectPrompt,
  parseCallerStyle,
} from './brain-mutation.js';
import { buildCallTimeContextPrompt } from './call-time.js';
import {
  buildLeadMemoryRulesPrompt,
  buildOpenBookingPromptLine,
  getLeadMemoryRetentionHours,
} from './lead-memory.js';
import { appendHinglishGenderLock } from './hinglish-gender.js';
import { buildAgentDeliveryPrompt, buildPatienceTurnTakingPrompt } from './natural-speech.js';
import type { SkillsConfig } from './skills-types.js';
import {
  compactSystemPrompt,
  SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS,
} from './simulator2-compact-prompt.js';

/** Simulator 2.0 cascaded default — lightly happy / expressive Cartesia delivery. */
export const SIMULATOR2_DEFAULT_TTS_EMOTION = 'happy';

/** Fallback when Agent Studio has no llmModel saved. */
export const SIMULATOR2_DEFAULT_LLM_MODEL = 'gpt-5.4-mini';

export function resolveSimulator2LlmModel(): string {
  return process.env.OPENAI_SIMULATOR2_MODEL?.trim() || SIMULATOR2_DEFAULT_LLM_MODEL;
}

export type CallLlmProvider = 'gpt' | 'groq';

/** Live phone + Simulator 2.0 use the Agent Studio LLM. */
export function resolveCallLlm(agent?: {
  llmProvider?: string | null;
  llmModel?: string | null;
}): { provider: CallLlmProvider; model: string } {
  const provider: CallLlmProvider = agent?.llmProvider === 'groq' ? 'groq' : 'gpt';
  const model = agent?.llmModel?.trim();
  if (model) return { provider, model };
  if (provider === 'groq') {
    return {
      provider,
      model:
        process.env.GROQ_MODEL?.trim() ||
        process.env.GROQ_FALLBACK_MODEL?.trim() ||
        'llama-3.3-70b-versatile',
    };
  }
  return { provider: 'gpt', model: resolveSimulator2LlmModel() };
}

export function resolveSimulator2TtsEmotion(raw?: string | null): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed || trimmed === 'neutral') return SIMULATOR2_DEFAULT_TTS_EMOTION;
  return trimmed;
}

export interface Simulator2ProspectMemory {
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  factsMarkdown?: string;
  callerStyle?: string;
}

export interface Simulator2InstructionAgent {
  name: string;
  greeting: string;
  productName: string;
  voiceLanguages?: string | null;
  agentGender?: string;
  compiledSystemPrompt: string;
  brainSummary?: string | null;
  generalKnowledgeEnabled?: boolean;
  skillsConfig?: SkillsConfig | null;
  brainLearnings?: string | null;
  retrievedGlobalLearnings?: string | null;
  knownContact?: KnownContactProfile | null;
  prospectMemory?: Simulator2ProspectMemory | null;
  /** Open/upcoming booking summary from runtime (not past/used). */
  openBookingSummary?: string | null;
  /** When true, consumed history exists — recall cue may unlock a short acknowledge. */
  hasConsumedLeadHistory?: boolean;
}

export interface Simulator2Instructions {
  instructions: string;
  knownContact: KnownContactProfile;
}

export function assembleAgentInstructions(opts: {
  agent: Simulator2InstructionAgent;
  direction: CallDirection;
  prospectName?: string;
  contactPhone?: string;
  contactEmail?: string;
  skills: SkillsConfig;
  refreshLanguagePrompt: (prompt: string, languages?: string | null) => string;
  ensureGenderPrompt: (
    prompt: string,
    gender: string | undefined,
    languages?: string | null,
  ) => string;
  buildCallDirectionPrompt: (
    direction: CallDirection,
    agent: Pick<Simulator2InstructionAgent, 'name' | 'productName' | 'greeting'>,
    context?: { prospectName?: string },
  ) => string;
}): Simulator2Instructions {
  const { agent, direction, prospectName, contactPhone, contactEmail, skills } = opts;

  const knownContact = mergeKnownContact(agent.knownContact, {
    name: prospectName,
    phone: contactPhone,
    email: contactEmail,
  });

  const cappedPrompt = compactSystemPrompt(
    agent.compiledSystemPrompt,
    agent.brainSummary,
    SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS,
    agent.generalKnowledgeEnabled !== false,
  );
  const basePrompt = opts.ensureGenderPrompt(
    opts.refreshLanguagePrompt(cappedPrompt, agent.voiceLanguages),
    agent.agentGender,
    agent.voiceLanguages,
  );
  const retentionHours = getLeadMemoryRetentionHours(skills);
  const callerContextBlock = buildCallerContextPrompt(knownContact, direction);
  const demoOverrideBlock = buildDemoKnownContactRules(knownContact);
  const leadMemoryRulesBlock = buildLeadMemoryRulesPrompt(retentionHours);
  const openBookingBlock = buildOpenBookingPromptLine(agent.openBookingSummary);
  const learningsBlock = buildLearningsPrompt(
    agent.retrievedGlobalLearnings || agent.brainLearnings,
  );
  const prospectBlock = buildProspectPrompt(
    agent.prospectMemory?.factsMarkdown,
    agent.prospectMemory?.callerStyle,
    {
      displayName: knownContact.name ?? agent.prospectMemory?.displayName,
      email: knownContact.email ?? agent.prospectMemory?.email,
      phone: knownContact.phone ?? agent.prospectMemory?.phone,
    },
  );
  const styleFromProspect = parseCallerStyle(agent.prospectMemory?.callerStyle);
  const callerStyleBlock =
    styleFromProspect && styleFromProspect !== 'neutral'
      ? buildCallerStylePrompt(styleFromProspect)
      : '';
  const directionPrompt = opts.buildCallDirectionPrompt(direction, agent, {
    prospectName: knownContact.name ?? prospectName,
  });
  const toneBlock = buildAgentDeliveryPrompt(undefined, agent.productName);
  const patienceBlock = buildPatienceTurnTakingPrompt(skills.runtime?.holdAckLine ?? 'Ji.');
  const callTimeBlock = buildCallTimeContextPrompt();
  // Static agent brain first so OpenAI can prefix-cache Product Knowledge / principles
  // across calls. Call-specific notepad (contact, time, learnings) stays at the tail.
  // Gender lock is last so S2S prompt trim cannot drop first-person grammar.
  const instructions = [
    basePrompt,
    toneBlock,
    patienceBlock,
    directionPrompt,
    callTimeBlock,
    callerContextBlock,
    demoOverrideBlock,
    leadMemoryRulesBlock,
    openBookingBlock,
    learningsBlock,
    prospectBlock,
    callerStyleBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    instructions: appendHinglishGenderLock(instructions, agent.agentGender),
    knownContact,
  };
}

/** @deprecated Use assembleAgentInstructions. */
export function assembleSimulator2InstructionBlocks(
  opts: Parameters<typeof assembleAgentInstructions>[0],
): Simulator2Instructions {
  return assembleAgentInstructions(opts);
}
