import { Router } from 'express';
import { AccessToken, type RoomConfiguration } from 'livekit-server-sdk';
import { z } from 'zod';
import { prisma } from '../db.js';

export const livekitRouter = Router();

livekitRouter.post('/token', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    participantName: z.string().optional(),
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
    prospectName: z.string().optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return res.status(500).json({ error: 'LiveKit is not configured' });
  }

  const roomName = `call-${agent.id}-${Date.now()}`;
  const participantName = parsed.data.participantName ?? 'user';

  const direction = parsed.data.direction;
  const prospectName = parsed.data.prospectName?.trim() || null;
  const contactPhone = parsed.data.contactPhone?.trim() || null;
  const contactEmail = parsed.data.contactEmail?.trim() || null;

  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      roomName,
      direction,
      prospectName,
      contactPhone,
      contactEmail,
    },
  });

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    ttl: '1h',
    metadata: JSON.stringify({
      agentId: agent.id,
      callId: call.id,
      direction,
      ...(prospectName ? { prospectName } : {}),
      ...(contactPhone ? { contactPhone } : {}),
      ...(contactEmail ? { contactEmail } : {}),
    }),
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canSubscribeMetrics: true,
  });
  token.roomConfig = {
    agents: [{ agentName: 'voice-sales-agent' }],
  } as RoomConfiguration;

  const jwt = await token.toJwt();

  res.json({
    token: jwt,
    url: livekitUrl,
    roomName,
    callId: call.id,
    agentId: agent.id,
  });
});
