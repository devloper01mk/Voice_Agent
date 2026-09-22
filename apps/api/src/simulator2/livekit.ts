import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { AccessToken, type RoomConfiguration } from 'livekit-server-sdk';
import { z } from 'zod';
import {
  normalizeRealtimeS2sUserConfig,
  normalizeVoicePipeline,
  resolveGeminiLiveVoice,
  resolveRealtimeVoice,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';
import { prisma } from '../db.js';
import type { Simulator2CallSessionPayload } from './session-config.js';

export const simulator2LivekitRouter = Router();

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const AGENT_V2_NAME = 'voice-sales-agent-v2';

simulator2LivekitRouter.post('/token', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    participantName: z.string().optional(),
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
    prospectName: z.string().optional(),
    contactPhone: z.string().optional(),
    contactEmail: z.string().optional(),
    /** Simulator-only: override Studio pipeline for this session (cascaded | openai_realtime | gemini_live). */
    voicePipeline: z.enum(['cascaded', 'openai_realtime', 'gemini_live']).optional(),
    realtimeVoice: z.string().max(40).optional(),
    /** Loosely validated — normalized via normalizeRealtimeS2sUserConfig below. */
    realtimeS2sConfig: z.record(z.string(), z.unknown()).optional(),
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

  const roomName = `call-v2-${agent.id}-${Date.now()}`;
  const participantName = parsed.data.participantName ?? 'user';
  const direction = parsed.data.direction;
  const prospectName = parsed.data.prospectName?.trim() || null;
  const contactPhone = parsed.data.contactPhone?.trim() || null;
  const contactEmail = parsed.data.contactEmail?.trim() || null;

  const voicePipeline = normalizeVoicePipeline(
    parsed.data.voicePipeline ?? agent.voicePipeline,
  );
  const forceS2s =
    parsed.data.voicePipeline === 'openai_realtime' ||
    parsed.data.voicePipeline === 'gemini_live';
  let realtimeS2sConfig: RealtimeS2sUserConfig | undefined;
  if (voicePipeline === 'openai_realtime' || voicePipeline === 'gemini_live') {
    if (forceS2s) {
      // Simulator override — use request body config
      realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
        (parsed.data.realtimeS2sConfig ?? {}) as Partial<RealtimeS2sUserConfig>,
        voicePipeline,
      );
    } else {
      // Use Agent Studio saved config (fixed per agent)
      const fromAgent =
        agent.realtimeS2sConfig && typeof agent.realtimeS2sConfig === 'object'
          ? (agent.realtimeS2sConfig as Partial<RealtimeS2sUserConfig>)
          : {};
      const fromReq =
        parsed.data.realtimeS2sConfig && typeof parsed.data.realtimeS2sConfig === 'object'
          ? (parsed.data.realtimeS2sConfig as Partial<RealtimeS2sUserConfig>)
          : {};
      realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
        { ...fromAgent, ...fromReq },
        voicePipeline,
      );
    }
  }
  const realtimeVoice =
    voicePipeline === 'gemini_live'
      ? resolveGeminiLiveVoice(
          realtimeS2sConfig?.voice ?? parsed.data.realtimeVoice ?? agent.realtimeVoice,
        )
      : resolveRealtimeVoice(
          realtimeS2sConfig?.voice ?? parsed.data.realtimeVoice ?? agent.realtimeVoice,
        );
  if (realtimeS2sConfig) {
    realtimeS2sConfig.voice = realtimeVoice;
  }

  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      roomName,
      direction,
      prospectName,
      contactPhone,
      contactEmail,
      transcript: toInputJson({
        v2Session: {
          voicePipeline,
          realtimeVoice,
          ...(realtimeS2sConfig ? { realtimeS2sConfig } : {}),
        } satisfies Simulator2CallSessionPayload,
      }),
    },
  });

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    ttl: '1h',
    metadata: JSON.stringify({
      agentId: agent.id,
      callId: call.id,
      direction,
      simulatorVersion: '2.0',
      voicePipeline,
      realtimeVoice,
      ...(realtimeS2sConfig
        ? {
            realtimeS2sConfig,
            s2sVoice: realtimeS2sConfig.voice,
            s2sModel: realtimeS2sConfig.model,
          }
        : {}),
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
    agents: [{ agentName: AGENT_V2_NAME }],
  } as RoomConfiguration;

  const jwt = await token.toJwt();

  res.json({
    token: jwt,
    url: livekitUrl,
    roomName,
    callId: call.id,
    agentId: agent.id,
    voicePipeline,
    realtimeVoice,
    realtimeS2sConfig,
  });
});
