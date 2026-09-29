import { Router } from 'express';
import {
  applyPlaybookToSkills,
  resolvePlaybook,
  buildGlobalLearningRetrievalQuery,
  compileSystemPrompt,
  mergeSkillsConfig,
  normalizeVoicePipeline,
  prospectKeyFromName,
  resolveCallLlm,
  resolveRealtimeVoice,
  type SkillsConfig,
} from '@vsa/shared';
import { prisma } from '../db.js';
import { resolveKnownContact } from '../known-contact.js';
import { productKnowledgeToolPayload, searchProductKnowledge } from '../product-knowledge.js';
import {
  backfillGlobalLearningsFromText,
  countGlobalLearningVectors,
  retrieveGlobalLearnings,
} from '../vector-learnings.js';

/** Smaller learnings cap for low-latency Simulator 2.0 runtime. */
const SIMULATOR2_LEARNING_LIMIT = 3;

export const simulator2RuntimeRouter = Router();

simulator2RuntimeRouter.post('/:id/knowledge-search', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query : '';
  const limit = Math.min(8, Math.max(1, Number(req.body?.limit) || 4));
  try {
    const result = await searchProductKnowledge(req.params.id, query, limit);
    console.info(
      `[product-knowledge] search agent=${req.params.id} mode=${result.mode} found=${result.found} ${result.latency_ms}ms q=${JSON.stringify(query.slice(0, 80))}`,
    );
    res.json(productKnowledgeToolPayload(result));
  } catch (err) {
    console.warn('[product-knowledge] search failed:', err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: 'Product knowledge search failed' });
  }
});

simulator2RuntimeRouter.get('/:id/runtime', async (req, res) => {
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
  let retrievedGlobalLearnings = '';
  try {
    const retrieved = await retrieveGlobalLearnings(
      agent.id,
      retrievalQuery,
      SIMULATOR2_LEARNING_LIMIT,
    );
    retrievedGlobalLearnings = retrieved.join('\n');
  } catch (err) {
    console.warn(
      '[runtime] retrieveGlobalLearnings failed:',
      err instanceof Error ? err.message : err,
    );
  }

  const generalKnowledgeEnabled = agent.generalKnowledgeEnabled !== false;
  const callLlm = resolveCallLlm(agent);
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
    voicePipeline: normalizeVoicePipeline(agent.voicePipeline),
    realtimeVoice: resolveRealtimeVoice(agent.realtimeVoice),
    llmProvider: callLlm.provider,
    llmModel: callLlm.model,
    sttProvider: 'none',
    sttModel: '',
    simulatorRuntime: {
      llmProvider: callLlm.provider,
      llmModel: callLlm.model,
      studioLlmProvider: agent.llmProvider,
      studioLlmModel: agent.llmModel,
      studioSttProvider: 'none',
      studioSttModel: '',
      voicePipeline: normalizeVoicePipeline(agent.voicePipeline),
      realtimeVoice: resolveRealtimeVoice(agent.realtimeVoice),
    },
    agentGender: agent.agentGender,
    playbook: resolvePlaybook(agent.playbook, skillsConfig.booking),
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
