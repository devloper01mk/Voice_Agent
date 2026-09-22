import { Router } from 'express';
import {
  approveBrainMutation,
  clearBrainLearnings,
  rejectBrainMutation,
} from '../brain-mutation.js';
import { prisma } from '../db.js';

export const mutationsRouter = Router({ mergeParams: true });

mutationsRouter.get('/', async (req, res) => {
  const agentId = String((req.params as { id: string }).id);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const take = Math.min(Number(req.query.limit) || 50, 100);

  const mutations = await prisma.brainMutation.findMany({
    where: status ? { agentId, status } : { agentId },
    orderBy: { createdAt: 'desc' },
    take,
  });
  res.json(mutations);
});

mutationsRouter.post('/clear-learnings', async (req, res) => {
  const agentId = String((req.params as { id: string }).id);
  await clearBrainLearnings(agentId);
  res.json({ ok: true });
});

mutationsRouter.post('/:mutationId/approve', async (req, res) => {
  try {
    await approveBrainMutation(req.params.mutationId);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Approve failed';
    res.status(500).json({ error: message });
  }
});

mutationsRouter.post('/:mutationId/reject', async (req, res) => {
  await rejectBrainMutation(req.params.mutationId);
  res.json({ ok: true });
});
