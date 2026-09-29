import {
  appendUniqueBullet,
  buildKnowledgeCorpus,
  canAutoApplyGlobalCategory,
  detectCallerStyle,
  formatGlobalLearningBullet,
  isDuplicateKnowledge,
  isProspectLearningAllowed,
  linesFromTranscriptPayload,
  looksLikeAbuseOrInsult,
  normalizeGlobalCategory,
  prospectKeyFromName,
} from '@vsa/shared';
import { callLlmJson } from './llm-chat.js';
import { prisma } from './db.js';
import { applyLearningFeedbackByContent, storeGlobalLearningVector } from './vector-learnings.js';

const MAX_AUTO_GLOBAL_PER_CALL = 2;

const EXTRACT_SYSTEM = `You extract reusable sales learnings from voice-call transcripts. Return ONLY valid JSON, no markdown fences.

globalLearnings: playbooks for ALL future customers (not this caller's name). Max 2 items per call.
prospectLearnings: facts about THIS caller only (business, tools, goals, timing). Max 4 bullets.
callerStyle: casual|formal|direct|friendly|neutral

Global categories (use exactly one per item):
- objection: common objection + how to handle (playbook, not raw quote)
- situation: recurring sales situation + recommended approach
- discovery: questions to ask on future similar calls
- qualification: how to qualify similar leads
- approach: trust-building or conversation strategy tip
- competitor: pivot playbook when competitor mentioned (no competitor facts)
- vertical: industry-specific pitch angle (retail, services, etc.)
- closing: when to offer demo/callback/next step
- reengage: follow-up or second-call approach
- exit: polite disqualification when not a fit
- faq: common question pattern + how to answer from product knowledge
- gap: possible product knowledge gap (needs human review — use sparingly)
- pricing: pricing discussion (needs human review — use sparingly)

Rules:
- Playbook format: "When X → do Y" or "Common objection: X → respond with Y"
- Prefer situational coaching that adapts behavior (tone, brevity, empathy, next step) based on caller state.
- If caller seems frustrated/angry/confused/in a hurry, capture that as a reusable playbook in situation/approach category.
- NO prospect names, NO verbatim insults, NO raw negative quotes
- NO product facts already covered in existing product knowledge
- NO pricing numbers unless explicitly stated in transcript and verified
- prospectLearnings: tools they use, team size, goals, callback preferences — NO insults
- Skip items already in existing learnings or product knowledge

JSON shape:
{
  "globalLearnings": [{ "category": "objection|situation|...", "text": "..." }],
  "prospectLearnings": ["..."],
  "callerStyle": "casual|formal|direct|friendly|neutral"
}`;

interface ExtractResult {
  globalLearnings?: Array<{ category?: string; text?: string }>;
  prospectLearnings?: string[];
  callerStyle?: string;
}

function ensurePlaybookShape(text: string, category: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  if (/^when\b/i.test(clean) || /^common objection:/i.test(clean)) return clean;

  if (category === 'objection') {
    return `Common objection: ${clean} -> respond with empathy, one clear value point, and one qualifying question.`;
  }
  return `When this situation appears: ${clean} -> acknowledge briefly, adapt tone, and guide to one next step question.`;
}

function normalizeStyle(raw?: string): string {
  const s = (raw ?? 'neutral').toLowerCase().trim();
  if (['casual', 'formal', 'direct', 'friendly', 'neutral'].includes(s)) return s;
  return 'neutral';
}

function productKnowledgeForExtract(agent: {
  brainSummary: string;
  brainMarkdown: string;
}): string {
  const summary = agent.brainSummary?.trim();
  if (summary) return summary;
  return agent.brainMarkdown.trim();
}

async function releaseBrainMutationClaim(callId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId },
    data: { brainMutationAt: null },
  });
}

/** Atomically claim this call so concurrent PATCH handlers only process once. */
async function tryClaimBrainMutation(callId: string): Promise<boolean> {
  const claimed = await prisma.call.updateMany({
    where: { id: callId, brainMutationAt: null },
    data: { brainMutationAt: new Date() },
  });
  return claimed.count > 0;
}

export async function runBrainMutation(callId: string): Promise<void> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: { agent: true },
  });
  if (!call?.transcript || !call.agent.learningsEnabled) return;
  if (call.brainMutationAt) return;

  const lines = linesFromTranscriptPayload(call.transcript);
  if (lines.length === 0) return;

  if (!(await tryClaimBrainMutation(callId))) return;

  try {
    await processBrainMutation(call, lines);
  } catch (err) {
    await releaseBrainMutationClaim(callId);
    throw err;
  }
}

async function processBrainMutation(
  call: {
    id: string;
    prospectName: string | null;
    agent: {
      id: string;
      productName: string;
      brainSummary: string;
      brainMarkdown: string;
      brainLearnings: string;
      llmProvider: string;
      llmModel: string;
    };
  },
  lines: ReturnType<typeof linesFromTranscriptPayload>,
): Promise<void> {

  const userTexts = lines.filter((l) => l.role === 'user').map((l) => l.text);
  const transcriptText = lines.map((l) => `${l.role}: ${l.text}`).join('\n');
  const ruleStyle = detectCallerStyle(userTexts);

  const agent = call.agent;
  const callId = call.id;
  const corpus = buildKnowledgeCorpus({
    brainSummary: agent.brainSummary,
    brainMarkdown: agent.brainMarkdown,
    brainLearnings: agent.brainLearnings,
  });

  let extracted: ExtractResult = {};
  try {
    extracted = await callLlmJson<ExtractResult>({
      llmProvider: 'gpt',
      llmModel: agent.llmModel,
      system: EXTRACT_SYSTEM,
      user: `Product: ${agent.productName}
Prospect on this call: ${call.prospectName ?? 'unknown'}

Existing product knowledge (do NOT repeat):
${productKnowledgeForExtract(agent)}

Existing global learnings (do NOT repeat):
${agent.brainLearnings || '(none)'}

Transcript:
${transcriptText}`,
      maxTokens: 800,
    });
  } catch {
    extracted = { callerStyle: ruleStyle };
  }

  const callerStyle = normalizeStyle(extracted.callerStyle ?? ruleStyle);
  let brainLearnings = agent.brainLearnings ?? '';
  let autoApplied = 0;
  let createdAny = false;
  let corpusMutable = corpus;

  const globals = (extracted.globalLearnings ?? []).filter((g) => g.text?.trim());

  for (const g of globals) {
    const category = normalizeGlobalCategory(g.category);
    const shaped = ensurePlaybookShape(g.text!.trim(), category);
    const bullet = formatGlobalLearningBullet(category, shaped);
    if (!bullet) continue;

    const text = g.text!.trim();

    if (looksLikeAbuseOrInsult(text)) {
      await prisma.brainMutation.create({
        data: {
          agentId: agent.id,
          callId,
          kind: category,
          content: bullet,
          status: 'skipped',
        },
      });
      createdAny = true;
      continue;
    }

    if (isDuplicateKnowledge(bullet, corpusMutable)) {
      await prisma.brainMutation.create({
        data: {
          agentId: agent.id,
          callId,
          kind: category,
          content: bullet,
          status: 'skipped_duplicate',
        },
      });
      createdAny = true;
      continue;
    }

    if (canAutoApplyGlobalCategory(category, text) && autoApplied < MAX_AUTO_GLOBAL_PER_CALL) {
      brainLearnings = appendUniqueBullet(brainLearnings, bullet);
      corpusMutable = `${corpusMutable}\n${bullet}`;
      autoApplied += 1;
      await storeGlobalLearningVector({
        agentId: agent.id,
        callId,
        kind: category,
        content: bullet,
      });
      await applyLearningFeedbackByContent(agent.id, bullet, 'success');
      await prisma.brainMutation.create({
        data: {
          agentId: agent.id,
          callId,
          kind: category,
          content: bullet,
          status: 'auto_applied',
        },
      });
      createdAny = true;
      continue;
    }

    await prisma.brainMutation.create({
      data: {
        agentId: agent.id,
        callId,
        kind: category,
        content: bullet,
        status: 'held',
      },
    });
    createdAny = true;
  }

  if (autoApplied > 0) {
    await prisma.agent.update({
      where: { id: agent.id },
      data: { brainLearnings },
    });
  }

  const prospectKey = prospectKeyFromName(call.prospectName);
  if (prospectKey) {
    const existing = await prisma.prospectMemory.findUnique({
      where: { agentId_prospectKey: { agentId: agent.id, prospectKey } },
    });

    let facts = existing?.factsMarkdown ?? '';
    for (const b of (extracted.prospectLearnings ?? []).filter((s) => s.trim())) {
      if (!isProspectLearningAllowed(b)) continue;
      facts = appendUniqueBullet(facts, b);
    }

    await prisma.prospectMemory.upsert({
      where: { agentId_prospectKey: { agentId: agent.id, prospectKey } },
      create: {
        agentId: agent.id,
        prospectKey,
        displayName: call.prospectName?.trim() || null,
        factsMarkdown: facts,
        callerStyle,
        lastCallId: callId,
      },
      update: {
        displayName: call.prospectName?.trim() || undefined,
        factsMarkdown: facts || undefined,
        callerStyle,
        lastCallId: callId,
      },
    });
  }

  if (!createdAny) {
    await prisma.brainMutation.create({
      data: {
        agentId: agent.id,
        callId,
        kind: 'call',
        content: 'No new global learnings from this call',
        status: 'processed',
      },
    });
  }
}

export async function approveBrainMutation(mutationId: string): Promise<void> {
  const mutation = await prisma.brainMutation.findUnique({
    where: { id: mutationId },
    include: { agent: true },
  });
  if (!mutation || !['held', 'pending'].includes(mutation.status)) return;

  const corpus = buildKnowledgeCorpus({
    brainSummary: mutation.agent.brainSummary,
    brainMarkdown: mutation.agent.brainMarkdown,
    brainLearnings: mutation.agent.brainLearnings,
  });

  if (isDuplicateKnowledge(mutation.content, corpus)) {
    await prisma.brainMutation.update({
      where: { id: mutationId },
      data: { status: 'skipped_duplicate' },
    });
    return;
  }

  const learnings = appendUniqueBullet(mutation.agent.brainLearnings, mutation.content);
  await storeGlobalLearningVector({
    agentId: mutation.agentId,
    callId: mutation.callId,
    kind: mutation.kind,
    content: mutation.content,
  });
  await applyLearningFeedbackByContent(mutation.agentId, mutation.content, 'success');

  await prisma.$transaction([
    prisma.agent.update({
      where: { id: mutation.agentId },
      data: { brainLearnings: learnings },
    }),
    prisma.brainMutation.update({
      where: { id: mutationId },
      data: { status: 'approved' },
    }),
  ]);
}

export async function rejectBrainMutation(mutationId: string): Promise<void> {
  const mutation = await prisma.brainMutation.findUnique({ where: { id: mutationId } });
  await prisma.brainMutation.updateMany({
    where: { id: mutationId, status: { in: ['held', 'pending'] } },
    data: { status: 'rejected' },
  });
  if (mutation) {
    await applyLearningFeedbackByContent(mutation.agentId, mutation.content, 'failure');
  }
}

export async function clearBrainLearnings(agentId: string): Promise<void> {
  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agentId },
      data: { brainLearnings: '' },
    }),
    prisma.globalLearningVector.deleteMany({ where: { agentId } }),
  ]);
}
