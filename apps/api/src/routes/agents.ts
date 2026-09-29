import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_SKILLS,
  type AgentInput,
  AGENT_RULES_MAX_CHARS,
  applyPlaybookToSkills,
  compileSystemPrompt,
  normalizePlaybook,
  resolvePlaybook,
  estimateTokens,
  mergeSkillsConfig,
  normalizeVoicePipeline,
  normalizeRealtimeS2sUserConfig,
  resolveGeminiLiveVoice,
  isS2sPipeline,
  type RealtimeS2sUserConfig,
  type SkillsConfig,
  type VoicePipeline,
} from '@vsa/shared';
import { summarizeProductKnowledge } from '../brain-summary.js';
import { prisma } from '../db.js';
import { mutationsRouter } from './mutations.js';
import { buildGlobalLearningRetrievalQuery, prospectKeyFromName } from '@vsa/shared';
import { countGlobalLearningVectors, retrieveGlobalLearnings, backfillGlobalLearningsFromText } from '../vector-learnings.js';
import { resolveKnownContact } from '../known-contact.js';
import { reindexProductKnowledge } from '../product-knowledge.js';

/** Index in the background — saving the agent must not wait on embeddings. */
function queueProductKnowledgeReindex(agentId: string, brainMarkdown: string) {
  void reindexProductKnowledge(agentId, brainMarkdown).catch((err) => {
    console.warn(
      '[agents] product knowledge reindex failed:',
      err instanceof Error ? err.message : err,
    );
  });
}

function learningRetrievalLimit(): number {
  const explicit = process.env.LEARNING_VECTOR_TOP_K;
  if (explicit != null && explicit !== '') {
    return Number(explicit);
  }
  const profile = process.env.LATENCY_PROFILE?.toLowerCase();
  if (profile === 'low') return 3;
  if (profile === 'balanced') return 4;
  return 5;
}

function storedRealtimeS2sConfig(
  raw: unknown,
  voicePipeline: VoicePipeline,
  realtimeVoice?: string | null,
): RealtimeS2sUserConfig | undefined {
  if (!isS2sPipeline(voicePipeline)) return undefined;
  const partial =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<RealtimeS2sUserConfig>)
      : {};
  const config = normalizeRealtimeS2sUserConfig(
    {
      ...partial,
      ...(realtimeVoice ? { voice: realtimeVoice } : {}),
    },
    voicePipeline,
  );
  config.voice = resolveGeminiLiveVoice(config.voice);
  return config;
}

const skillsSchema = z.object({
  angry: z
    .object({
      acknowledge: z.string(),
      deescalate: z.string(),
    })
    .optional(),
  busy: z.object({
    acknowledge: z.string(),
    callbackQuestion: z.string(),
    confirmTemplate: z.string(),
  }),
  support: z
    .object({
      acknowledge: z.string(),
      collectContact: z.string(),
      handoffPromise: z.string(),
    })
    .optional(),
  objection: z
    .object({
      empathyLine: z.string(),
      priceResponse: z.string(),
      excelResponse: z.string(),
      thinkItOverResponse: z.string(),
    })
    .optional(),
  discovery: z
    .object({
      openQuestion: z.string(),
      painProbe: z.string(),
      currentToolsQuestion: z.string(),
    })
    .optional(),
  competitor: z.object({
    boundaryTemplate: z.string(),
    pivotQuestion: z.string(),
    demoBridge: z.string(),
  }),
  exit: z
    .object({
      notInterestedLine: z.string(),
      politeClose: z.string(),
    })
    .optional(),
  demoOfferScript: z.string(),
  demo: z
    .object({
      nameConfirmTemplate: z.string().optional(),
      nameSpellRetryTemplate: z.string().optional(),
      phoneConfirmTemplate: z.string().optional(),
      phoneSpellRetryTemplate: z.string().optional(),
      knownEmailDomains: z.array(z.string()).optional(),
    })
    .optional(),
  unclear: z
    .object({
      lineUnclearTemplate: z.string().optional(),
      intentConfirmTemplate: z.string().optional(),
    })
    .optional(),
  offTopic: z.object({
    refusalTemplate: z.string(),
    personalRefusalTemplate: z.string().optional(),
    redirectQuestion: z.string(),
    maxRedirects: z.number(),
  }),
  timepass: z.object({
    maxCasualTurns: z.number(),
    redirectLine: z.string(),
    exitLine: z.string(),
  }),
  core: z
    .object({
      dnc: z.object({ confirmLine: z.string() }).optional(),
      wrongNumber: z.object({ apologizeLine: z.string() }).optional(),
      gatekeeper: z
        .object({ askScript: z.string(), callbackOffer: z.string() })
        .optional(),
      identity: z.object({ whoIsCalling: z.string() }).optional(),
      privacy: z
        .object({ leadSourceAnswer: z.string(), recordingObjection: z.string() })
        .optional(),
      humanHandoff: z.object({ acknowledge: z.string() }).optional(),
      detailsChannel: z.object({ sendDetailsPromise: z.string() }).optional(),
      abusive: z.object({ boundaryLine: z.string() }).optional(),
      silence: z
        .object({ checkInLine: z.string(), goodbyeLine: z.string() })
        .optional(),
      audioIssue: z
        .object({ checkLine: z.string(), callbackOffer: z.string() })
        .optional(),
      voicemail: z.object({ messageScript: z.string() }).optional(),
      ivr: z.object({ receptionistScript: z.string() }).optional(),
    })
    .optional(),
  compliance: z.object({ recordingDisclosure: z.string() }).optional(),
  runtime: z
    .object({
      holdAckLine: z.string(),
      exploringSilenceMs: z.number(),
      holdSoftCheckinMs: z.number(),
      silenceFirstPromptSec: z.number(),
      silenceEndSec: z.number(),
      leadMemoryRetentionHours: z.union([
        z.literal(0),
        z.literal(24),
        z.literal(48),
        z.literal(168),
        z.literal(720),
      ]).optional(),
    })
    .optional(),
  booking: z
    .object({
      templateId: z.enum(['crm_demo', 'hotel_stay', 'auto_test_drive', 'custom']).optional(),
      outcome: z.enum(['demo', 'visit', 'stay', 'callback', 'lead_only']).optional(),
      requiredFields: z
        .array(z.enum(['preferred_time', 'name', 'phone', 'party_size', 'email']))
        .optional(),
      discussBeforeSave: z
        .array(z.enum(['payment', 'cancellation', 'id_proof', 'budget']))
        .optional(),
      askEmail: z.boolean().optional(),
      notes: z.string().optional(),
      bookingType: z.string().max(48).optional(),
      speakAs: z.string().max(80).optional(),
      allowedBookingTypes: z.array(z.string().max(48)).max(8).optional(),
      locationType: z.string().max(32).optional(),
    })
    .optional(),
});

const agentSchema = z.object({
  name: z.string().min(1),
  greeting: z.string().min(1),
  persona: z.string().optional(),
  productName: z.string().optional(),
  voiceId: z.string().min(1),
  voiceLanguage: z.string().min(2).max(10).optional(),
  voiceLanguages: z.string().max(50).optional(),
  voiceSpeed: z.number().min(0.6).max(1.5).optional(),
  voicePitch: z.number().min(0.5).max(2).optional(),
  ttsModel: z.string().optional(),
  ttsSampleRate: z.number().int().optional(),
  ttsEmotion: z.string().max(40).optional(),
  voicePipeline: z.enum(['gemini_live']).optional(),
  realtimeVoice: z.string().max(40).optional(),
  /** Loosely validated — normalized via normalizeRealtimeS2sUserConfig. */
  realtimeS2sConfig: z.record(z.string(), z.unknown()).optional(),
  agentGender: z.enum(['female', 'male']).optional(),
  llmProvider: z.enum(['gpt']).optional(),
  llmModel: z.string().optional(),
  /** Accepted for API compat; always overwritten to none / ''. */
  sttProvider: z.string().optional(),
  sttModel: z.string().optional(),
  brainMarkdown: z.string(),
  agentRules: z.string().max(AGENT_RULES_MAX_CHARS).optional(),
  /** Loosely validated — normalized via normalizePlaybook. null clears it. */
  playbook: z.record(z.string(), z.unknown()).nullable().optional(),
  learningsEnabled: z.boolean().optional(),
  generalKnowledgeEnabled: z.boolean().optional(),
  skillsConfig: skillsSchema.optional(),
});

/** Fallback when Studio leaves product name empty — never a real brand. */
const FALLBACK_PRODUCT_NAME = 'our product';

const DEFAULT_BRAIN = `# Product knowledge

No product facts have been added yet. Answer only with what the caller can verify later and offer a callback for details.

## Out of scope — NEVER answer
- Loans, banking, legal, medical advice
- Competitor pricing unless listed here
- General knowledge unrelated to this product
`;

function normalizeVoiceLanguages(
  voiceLanguages?: string,
  voiceLanguage?: string,
): string {
  if (voiceLanguages?.trim()) return voiceLanguages.trim();
  if (voiceLanguage === 'hi') return 'hi';
  if (voiceLanguage === 'en') return 'en';
  return 'en,hi,hinglish';
}

function buildAgentData(
  body: {
    name: string;
    greeting: string;
    persona?: string;
    productName?: string;
    voiceId: string;
    voiceLanguage?: string;
    voiceLanguages?: string;
    voiceSpeed?: number;
    voicePitch?: number;
    ttsModel?: string;
    ttsSampleRate?: number;
    ttsEmotion?: string;
    voicePipeline?: VoicePipeline;
    realtimeVoice?: string;
    realtimeS2sConfig?: Partial<RealtimeS2sUserConfig> | null;
    agentGender?: string;
    llmProvider?: 'gpt';
    llmModel?: string;
    sttProvider?: string;
    sttModel?: string;
    brainMarkdown: string;
    agentRules?: string;
    playbook?: unknown;
    learningsEnabled?: boolean;
    generalKnowledgeEnabled?: boolean;
    skillsConfig: SkillsConfig;
  },
  brainSummary: string,
) {
  const playbook = normalizePlaybook(body.playbook);
  const skillsConfig = mergeSkillsConfig(body.skillsConfig);
  const voiceLanguages = normalizeVoiceLanguages(body.voiceLanguages, body.voiceLanguage);
  const generalKnowledgeEnabled = body.generalKnowledgeEnabled !== false;
  const voicePipeline = normalizeVoicePipeline(body.voicePipeline);
  const realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
    {
      ...(body.realtimeS2sConfig ?? {}),
      ...(body.realtimeVoice ? { voice: body.realtimeVoice } : {}),
    },
    voicePipeline,
  );
  const realtimeVoice = resolveGeminiLiveVoice(realtimeS2sConfig.voice);
  realtimeS2sConfig.voice = realtimeVoice;
  // Voice is Gemini Live only — persist Gemini voice id; ignore cascaded STT/TTS fields.
  const voiceId = resolveGeminiLiveVoice(body.realtimeVoice || body.voiceId || realtimeVoice);

  const promptInput: AgentInput = {
    name: body.name,
    greeting: body.greeting,
    persona: body.persona ?? 'friendly and professional',
    productName: body.productName?.trim() || FALLBACK_PRODUCT_NAME,
    voiceId,
    voiceLanguages,
    voiceSpeed: body.voiceSpeed ?? 1.0,
    agentGender: body.agentGender === 'male' ? 'male' : 'female',
    llmProvider: 'gpt',
    llmModel: body.llmModel ?? (process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
    brainMarkdown: body.brainMarkdown,
    brainSummary,
    generalKnowledgeEnabled,
    agentRules: body.agentRules?.trim() ?? '',
    playbook,
    skillsConfig,
  };
  const compiledSystemPrompt = compileSystemPrompt(promptInput);
  return {
    ...promptInput,
    playbook: playbook ? (playbook as object) : Prisma.DbNull,
    voiceLanguage: body.voiceLanguage ?? 'en',
    voicePitch: body.voicePitch ?? 1.0,
    ttsModel: 'gemini',
    ttsSampleRate: 24000,
    ttsEmotion: '',
    voicePipeline,
    realtimeVoice,
    realtimeS2sConfig: realtimeS2sConfig as object,
    llmProvider: promptInput.llmProvider,
    sttProvider: 'none',
    sttModel: '',
    brainSummary,
    learningsEnabled: body.learningsEnabled !== false,
    generalKnowledgeEnabled,
    compiledSystemPrompt,
    promptTokenCount: estimateTokens(compiledSystemPrompt),
    skillsConfig: skillsConfig as object,
  };
}

function fallbackBrainSummary(
  brainMarkdown: string,
  previousSummary?: string,
): string {
  const prev = previousSummary?.trim();
  if (prev) return prev;
  // Keep enough of the source so calls still have product facts if summarization fails.
  const trimmed = brainMarkdown.trim();
  if (trimmed.length <= 12_000) return trimmed;
  return `${trimmed.slice(0, 12_000)}\n\n[Summary unavailable — truncated source kept.]`;
}

async function resolveBrainSummary(
  merged: {
    productName: string;
    brainMarkdown: string;
    llmProvider: 'gpt';
    llmModel: string;
  },
  existing?: { brainMarkdown: string; brainSummary: string },
): Promise<string> {
  const unchanged =
    existing &&
    existing.brainMarkdown === merged.brainMarkdown &&
    existing.brainSummary.trim().length > 0;
  if (unchanged) {
    return existing.brainSummary;
  }

  try {
    return await summarizeProductKnowledge({
      productName: merged.productName,
      brainMarkdown: merged.brainMarkdown,
      llmProvider: merged.llmProvider,
      llmModel: merged.llmModel,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[agents] brain summarization failed; saving with fallback:', detail);
    return fallbackBrainSummary(merged.brainMarkdown, existing?.brainSummary);
  }
}

export const agentsRouter = Router();

agentsRouter.get('/', async (_req, res) => {
  const agents = await prisma.agent.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      productName: true,
      llmProvider: true,
      llmModel: true,
      sttProvider: true,
      sttModel: true,
      voicePipeline: true,
      realtimeVoice: true,
      voiceId: true,
      promptTokenCount: true,
      generalKnowledgeEnabled: true,
      skillsConfig: true,
      updatedAt: true,
    },
  });
  res.json(
    agents.map((a) => {
      const booking = mergeSkillsConfig(
        a.skillsConfig as unknown as Partial<SkillsConfig> | null,
      ).booking;
      return {
        id: a.id,
        name: a.name,
        productName: a.productName,
        llmProvider: a.llmProvider,
        llmModel: a.llmModel,
        sttProvider: a.sttProvider,
        sttModel: a.sttModel,
        voicePipeline: a.voicePipeline,
        realtimeVoice: a.realtimeVoice,
        voiceId: a.voiceId,
        promptTokenCount: a.promptTokenCount,
        generalKnowledgeEnabled: a.generalKnowledgeEnabled,
        updatedAt: a.updatedAt,
        bookingOutcome: booking?.outcome,
      };
    }),
  );
});

agentsRouter.use('/:id/mutations', mutationsRouter);

agentsRouter.get('/:id/prospects', async (req, res) => {
  const prospects = await prisma.prospectMemory.findMany({
    where: { agentId: req.params.id },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });
  res.json(prospects);
});

agentsRouter.get('/:id', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

agentsRouter.get('/:id/learning-stats', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const vectorCount = await countGlobalLearningVectors(agent.id);
  const aggregates = await prisma.globalLearningVector.aggregate({
    where: { agentId: agent.id },
    _avg: { confidenceScore: true },
    _sum: { usesCount: true, successCount: true, failureCount: true },
  });
  res.json({
    vectorCount,
    avgConfidenceScore: Number(aggregates._avg.confidenceScore ?? 0),
    totalLearningUses: aggregates._sum.usesCount ?? 0,
    totalLearningSuccesses: aggregates._sum.successCount ?? 0,
    totalLearningFailures: aggregates._sum.failureCount ?? 0,
    textLineCount: agent.brainLearnings
      ? agent.brainLearnings.split('\n').filter((l) => l.trim().startsWith('-')).length
      : 0,
  });
});

agentsRouter.get('/:id/runtime', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const prospectName =
    typeof req.query.prospectName === 'string' ? req.query.prospectName : undefined;
  const contactPhone =
    typeof req.query.contactPhone === 'string' ? req.query.contactPhone : undefined;
  const contactEmail =
    typeof req.query.contactEmail === 'string' ? req.query.contactEmail : undefined;

  const skillsConfig = applyPlaybookToSkills(
    mergeSkillsConfig(agent.skillsConfig as unknown as SkillsConfig),
    agent.playbook,
  );
  const memory = await resolveKnownContact(
    agent.id,
    {
      prospectName,
      contactPhone,
      contactEmail,
    },
    { skills: skillsConfig },
  );
  const knownContact = memory.knownContact;

  const key = prospectKeyFromName(prospectName ?? knownContact.name);
  const prospect =
    key && memory.retentionHours > 0
      ? await prisma.prospectMemory.findFirst({
          where: {
            agentId: agent.id,
            prospectKey: key,
            updatedAt: {
              gte: new Date(Date.now() - memory.retentionHours * 3_600_000),
            },
          },
        })
      : null;

  let globalLearningVectorCount = await countGlobalLearningVectors(agent.id);
  if (globalLearningVectorCount === 0 && agent.brainLearnings.trim()) {
    await backfillGlobalLearningsFromText(agent.id, agent.brainLearnings);
    globalLearningVectorCount = await countGlobalLearningVectors(agent.id);
  }

  const retrievalQuery = buildGlobalLearningRetrievalQuery({
    productName: agent.productName,
    prospectName: prospectName ?? knownContact.name,
    prospectFacts: prospect?.factsMarkdown,
    callerStyle: prospect?.callerStyle,
    productSummary: agent.brainSummary || agent.brainMarkdown,
  });
  const retrieved = await retrieveGlobalLearnings(agent.id, retrievalQuery, learningRetrievalLimit());
  const retrievedGlobalLearnings = retrieved.join('\n');

  const generalKnowledgeEnabled = agent.generalKnowledgeEnabled !== false;
  const voicePipeline = normalizeVoicePipeline(agent.voicePipeline);
  const realtimeS2sConfig = storedRealtimeS2sConfig(
    agent.realtimeS2sConfig,
    voicePipeline,
    agent.realtimeVoice,
  );
  const realtimeVoice =
    realtimeS2sConfig?.voice ?? resolveGeminiLiveVoice(agent.realtimeVoice);
  const compiledSystemPrompt = compileSystemPrompt({
    name: agent.name,
    greeting: agent.greeting,
    persona: agent.persona,
    productName: agent.productName,
    voiceId: agent.voiceId,
    voiceLanguages: agent.voiceLanguages,
    voiceSpeed: agent.voiceSpeed,
    agentGender: agent.agentGender === 'male' ? 'male' : 'female',
    llmProvider: 'gpt',
    llmModel: agent.llmModel,
    brainMarkdown: agent.brainMarkdown,
    brainSummary: agent.brainSummary,
    generalKnowledgeEnabled,
    agentRules: agent.agentRules,
    playbook: agent.playbook,
    skillsConfig,
  });

  res.json({
    id: agent.id,
    name: agent.name,
    greeting: agent.greeting,
    productName: agent.productName,
    voiceId: agent.voiceId,
    voiceLanguage: agent.voiceLanguage,
    voiceLanguages: agent.voiceLanguages,
    voiceSpeed: agent.voiceSpeed,
    voicePitch: agent.voicePitch,
    ttsModel: agent.ttsModel,
    ttsSampleRate: agent.ttsSampleRate ?? 24000,
    ttsEmotion: agent.ttsEmotion ?? '',
    voicePipeline,
    realtimeVoice,
    playbook: resolvePlaybook(agent.playbook, skillsConfig.booking),
    ...(realtimeS2sConfig ? { realtimeS2sConfig } : {}),
    llmProvider: agent.llmProvider,
    llmModel: agent.llmModel,
    sttProvider: 'none',
    sttModel: '',
    agentGender: agent.agentGender,
    compiledSystemPrompt,
    brainSummary: agent.brainSummary,
    generalKnowledgeEnabled,
    skillsConfig,
    brainLearnings: agent.brainLearnings,
    retrievedGlobalLearnings,
    globalLearningVectorCount,
    knownContact,
    openBookingSummary: memory.openBookingSummary,
    hasConsumedLeadHistory: memory.hasConsumedLeadHistory,
    prospectMemory: prospect
      ? {
          displayName: prospect.displayName,
          email: prospect.email,
          phone: prospect.phone,
          factsMarkdown: prospect.factsMarkdown,
          callerStyle: prospect.callerStyle,
        }
      : null,
  });
});

agentsRouter.post('/', async (req, res) => {
  const parsed = agentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const brainMarkdown = parsed.data.brainMarkdown || DEFAULT_BRAIN;
  const merged = {
    ...parsed.data,
    brainMarkdown,
    persona: parsed.data.persona ?? 'friendly and professional',
    productName: parsed.data.productName?.trim() || FALLBACK_PRODUCT_NAME,
    llmProvider: 'gpt' as const,
    llmModel: parsed.data.llmModel ?? (process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
    sttProvider: 'none',
    sttModel: '',
    // `skillsSchema` has optional nested fields (e.g. core.dnc). Cast so TS
    // doesn't block merge; mergeSkillsConfig falls back to defaults at runtime.
    skillsConfig: mergeSkillsConfig(
      parsed.data.skillsConfig as unknown as Partial<SkillsConfig> | null | undefined,
    ),
  };

  try {
    const brainSummary = await resolveBrainSummary(merged);
    const data = buildAgentData(merged, brainSummary);
    const agent = await prisma.agent.create({ data });
    queueProductKnowledgeReindex(agent.id, agent.brainMarkdown);
    res.status(201).json(agent);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brain summarization failed';
    res.status(502).json({ error: message });
  }
});

agentsRouter.put('/:id', async (req, res) => {
  const parsed = agentSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  const merged = {
    name: parsed.data.name ?? existing.name,
    greeting: parsed.data.greeting ?? existing.greeting,
    persona: parsed.data.persona ?? existing.persona,
    productName: parsed.data.productName ?? existing.productName,
    voiceId: parsed.data.voiceId ?? existing.voiceId,
    voiceLanguage: parsed.data.voiceLanguage ?? existing.voiceLanguage,
    voiceLanguages:
      parsed.data.voiceLanguages ??
      (parsed.data.voiceLanguage
        ? normalizeVoiceLanguages(undefined, parsed.data.voiceLanguage)
        : existing.voiceLanguages),
    voiceSpeed: parsed.data.voiceSpeed ?? existing.voiceSpeed,
    voicePitch: parsed.data.voicePitch ?? existing.voicePitch,
    ttsModel: 'gemini',
    ttsSampleRate: 24000,
    ttsEmotion: '',
    voicePipeline: normalizeVoicePipeline(
      parsed.data.voicePipeline ?? existing.voicePipeline,
    ),
    realtimeVoice: parsed.data.realtimeVoice ?? existing.realtimeVoice,
    realtimeS2sConfig:
      parsed.data.realtimeS2sConfig !== undefined
        ? (parsed.data.realtimeS2sConfig as Partial<RealtimeS2sUserConfig>)
        : ((existing.realtimeS2sConfig as Partial<RealtimeS2sUserConfig> | null) ?? null),
    agentGender:
      (parsed.data.agentGender ?? existing.agentGender) === 'male' ? 'male' : 'female',
    llmProvider: 'gpt' as const,
    llmModel: parsed.data.llmModel ?? existing.llmModel,
    sttProvider: 'none',
    sttModel: '',
    brainMarkdown: parsed.data.brainMarkdown ?? existing.brainMarkdown,
    agentRules: parsed.data.agentRules ?? existing.agentRules,
    playbook: parsed.data.playbook !== undefined ? parsed.data.playbook : existing.playbook,
    learningsEnabled: parsed.data.learningsEnabled ?? existing.learningsEnabled,
    generalKnowledgeEnabled:
      parsed.data.generalKnowledgeEnabled ?? existing.generalKnowledgeEnabled,
    skillsConfig: mergeSkillsConfig(
      (parsed.data.skillsConfig ?? existing.skillsConfig) as SkillsConfig,
    ),
  };

  try {
    const brainSummary = await resolveBrainSummary(merged, {
      brainMarkdown: existing.brainMarkdown,
      brainSummary: existing.brainSummary,
    });
    const data = buildAgentData(merged, brainSummary);
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data,
    });
    if (agent.brainMarkdown !== existing.brainMarkdown) {
      queueProductKnowledgeReindex(agent.id, agent.brainMarkdown);
    }
    res.json(agent);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brain summarization failed';
    res.status(502).json({ error: message });
  }
});

agentsRouter.delete('/:id', async (req, res) => {
  try {
    await prisma.agent.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: 'Agent not found' });
  }
});

export { DEFAULT_BRAIN };
