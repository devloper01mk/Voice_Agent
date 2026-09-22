import { Router } from 'express';
import type { RealtimeS2sUserConfig } from '@vsa/shared';
import { prisma } from '../db.js';

export const simulator2SessionConfigRouter = Router();

export type Simulator2CallSessionPayload = {
  voicePipeline?: string;
  realtimeVoice?: string;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
};

export function readSimulator2SessionPayload(transcript: unknown): Simulator2CallSessionPayload | null {
  if (!transcript || typeof transcript !== 'object') return null;
  const v2 = (transcript as { v2Session?: Simulator2CallSessionPayload }).v2Session;
  if (!v2 || typeof v2 !== 'object') return null;
  return v2;
}

simulator2SessionConfigRouter.get('/:callId/session-config', async (req, res) => {
  const call = await prisma.call.findUnique({
    where: { id: req.params.callId },
    select: { transcript: true, roomName: true },
  });
  if (!call) return res.status(404).json({ error: 'Call not found' });

  const session = readSimulator2SessionPayload(call.transcript);
  if (!session) {
    return res.status(404).json({ error: 'No Simulator 2.0 session config for this call' });
  }

  res.json(session);
});
