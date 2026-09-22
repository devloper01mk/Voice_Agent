import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { linesFromTranscriptPayload } from '@vsa/shared';
import { runBrainMutation } from '../brain-mutation.js';
import { dispatchCallCompletedWebhook } from '../call-webhook.js';
import { prisma } from '../db.js';
import { applyOutcomeFeedbackToRecentLearnings } from '../vector-learnings.js';
import { emitTelephonyEvent } from '../telephony/event-bus.js';

export const callsRouter = Router();

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function chooseOutcome(incoming?: string, existing?: string | null): string | undefined {
  const current = existing?.trim();
  const next = incoming?.trim();
  if (!next) return current ?? undefined;

  const priority = new Map<string, number>([
    ['demo_booked', 4],
    ['callback_scheduled', 3],
    ['voicemail_left', 2],
    ['completed', 1],
  ]);
  const currentRank = priority.get(current ?? '') ?? 0;
  const nextRank = priority.get(next) ?? 0;
  return nextRank >= currentRank ? next : current ?? next;
}

function inferOutcomeSignal(opts: {
  outcome?: string;
  transcript: unknown;
}): 'success' | 'failure' | null {
  const lines = linesFromTranscriptPayload(opts.transcript);
  const userLines = lines.filter((l) => l.role === 'user');
  const userText = userLines.map((l) => l.text).join(' ').toLowerCase();
  const outcome = (opts.outcome ?? '').toLowerCase().trim();

  if (outcome === 'demo_booked' || outcome === 'callback_scheduled') return 'success';

  const rejectionPattern =
    /\b(not interested|no need|stop calling|don'?t call|mat call|busy now|call mat)\b/;
  const hardRejection = rejectionPattern.test(userText);

  if (lines.length <= 2 || userLines.length <= 1) return hardRejection ? 'failure' : null;
  if (hardRejection) return 'failure';
  if (outcome === 'completed') return 'success';
  return null;
}

const transcriptLineSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'agent']),
  text: z.string(),
  isFinal: z.boolean().optional(),
  timestamp: z.number(),
});

const transcriptPayloadSchema = z.union([
  z.array(transcriptLineSchema),
  z.object({
    lines: z.array(transcriptLineSchema),
    metrics: z.record(z.unknown()).optional(),
  }),
]);

callsRouter.get('/', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    direction: z.enum(['inbound', 'outbound']).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    take: z.coerce.number().int().min(1).max(200).optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const where: {
    agentId: string;
    direction?: string;
    startedAt?: { gte?: Date; lt?: Date };
  } = { agentId: parsed.data.agentId };
  if (parsed.data.direction) where.direction = parsed.data.direction;
  if (parsed.data.from || parsed.data.to) {
    where.startedAt = {};
    if (parsed.data.from) where.startedAt.gte = new Date(parsed.data.from);
    if (parsed.data.to) where.startedAt.lt = new Date(parsed.data.to);
  }

  const calls = await prisma.call.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: parsed.data.take ?? 50,
    include: {
      leads: {
        select: {
          id: true,
          name: true,
          bookingType: true,
          status: true,
          scheduledStart: true,
        },
      },
      callbacks: {
        select: { id: true, preferredTime: true, status: true, scheduledAt: true },
      },
      agent: { select: { id: true, name: true } },
    },
  });

  res.json({
    calls: calls.map((c) => ({
      id: c.id,
      agentId: c.agentId,
      agentName: c.agent.name,
      direction: c.direction,
      source: c.source,
      status: c.status,
      toNumber: c.toNumber,
      fromNumber: c.fromNumber,
      prospectName: c.prospectName,
      contactPhone: c.contactPhone,
      contactEmail: c.contactEmail,
      outcome: c.outcome,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      hasTranscript: c.transcript != null,
      leads: c.leads,
      callbacks: c.callbacks,
    })),
  });
});

callsRouter.get('/:id', async (req, res) => {
  const call = await prisma.call.findUnique({
    where: { id: req.params.id },
    include: {
      leads: true,
      callbacks: true,
      agent: { select: { id: true, name: true } },
    },
  });
  if (!call) return res.status(404).json({ error: 'Call not found' });
  res.json(call);
});

callsRouter.patch('/:id', async (req, res) => {
  const schema = z.object({
    transcript: transcriptPayloadSchema.optional(),
    metrics: z.record(z.unknown()).optional(),
    outcome: z.string().optional(),
    status: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const existing = await prisma.call.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Call not found' });

  const incomingStatus = parsed.data.status?.toLowerCase().trim();
  const normalizedIncoming =
    incomingStatus === 'no_answer' || incomingStatus === 'dial_timeout'
      ? 'no-answer'
      : incomingStatus === 'busy'
        ? 'busy'
        : incomingStatus;

  const terminalStatus =
    normalizedIncoming === 'completed' ||
    normalizedIncoming === 'failed' ||
    normalizedIncoming === 'no-answer' ||
    normalizedIncoming === 'busy' ||
    parsed.data.transcript != null ||
    parsed.data.outcome != null;

  // Coerce in-progress/ringing → completed when transcript/outcome arrives without status.
  let nextStatus = normalizedIncoming ?? existing.status;
  if (
    terminalStatus &&
    (!normalizedIncoming ||
      normalizedIncoming === 'in-progress' ||
      normalizedIncoming === 'ringing' ||
      normalizedIncoming === 'queued')
  ) {
    nextStatus = 'completed';
  }

  const call = await prisma.call.update({
    where: { id: req.params.id },
    data: {
      transcript:
        parsed.data.transcript != null
          ? toInputJson(parsed.data.transcript)
          : existing.transcript != null
            ? (existing.transcript as Prisma.InputJsonValue)
            : undefined,
      outcome: chooseOutcome(parsed.data.outcome, existing.outcome),
      status: nextStatus,
      endedAt: terminalStatus ? new Date() : existing.endedAt,
    },
  });

  if (
    nextStatus &&
    nextStatus !== existing.status &&
    (nextStatus === 'in-progress' ||
      nextStatus === 'ringing' ||
      nextStatus === 'completed' ||
      nextStatus === 'failed' ||
      nextStatus === 'no-answer' ||
      nextStatus === 'busy')
  ) {
    emitTelephonyEvent(call.id, { type: 'status', status: nextStatus });
  }

  const shouldApplyOutcomeFeedback = !existing.endedAt || existing.outcome !== call.outcome;
  const outcomeSignal =
    shouldApplyOutcomeFeedback
      ? inferOutcomeSignal({
          outcome: call.outcome ?? undefined,
          transcript: call.transcript,
        })
      : null;
  if (outcomeSignal) {
    void applyOutcomeFeedbackToRecentLearnings({
      agentId: call.agentId,
      signal: outcomeSignal,
      referenceTime: call.endedAt ?? new Date(),
    }).catch((err) => {
      console.error('learning outcome feedback failed', call.id, err);
    });
  }

  if (parsed.data.transcript != null && existing.brainMutationAt == null) {
    void runBrainMutation(call.id).catch((err) => {
      console.error('brain mutation failed', call.id, err);
    });
  }

  if (terminalStatus) {
    void dispatchCallCompletedWebhook(call.id).catch((err) => {
      console.error('call.completed webhook failed', call.id, err);
    });
  }

  res.json(call);
});
