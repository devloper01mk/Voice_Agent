import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  normalizeRealtimeS2sUserConfig,
  normalizeVoicePipeline,
  type RealtimeS2sUserConfig,
} from '@vsa/shared';
import { prisma } from '../db.js';
import { hangupSmartfloWithCandidates, initiateClickToCallSupport } from './acefone-client.js';
import { dispatchCallCompletedWebhook } from '../call-webhook.js';
import { emitTelephonyEvent } from './event-bus.js';
import { handleTelephonySse } from './events-route.js';
import { getPendingCall, registerPendingCall, resolveCallId } from './call-registry.js';
import { dropPrefetchedRuntime, prefetchRuntimeAgent } from './llm-client.js';
import { warmOutboundOpener } from './opener-warm.js';
import { getCallSession } from './session-registry.js';
import { warmTelephonySttForCall, dropWarmedTelephonyStt } from './stt-warm.js';
import { publicWssUrl } from './ws-server.js';
import {
  normalizeTelephonyPipelineMode,
  resolveTelephonyAppliedPipeline,
  type TelephonyCallSessionPayload,
} from './session-config.js';
import {
  buildLivekitSipSessionMeta,
  extractLivekitSipFailure,
  formatLivekitSipFailureReason,
  hangupLivekitSipRoom,
  isLivekitSipConfigured,
  isLivekitWaitUntilAnsweredTimeout,
  livekitSipConfigError,
  maskPhone,
  placeLivekitSipOutbound,
} from './livekit-sip.js';

export const telephonyRouter = Router();

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function rawProviderStatus(body: Record<string, unknown>): string {
  const nested =
    body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : undefined;
  const value =
    body.status ??
    body.call_status ??
    body.CallStatus ??
    body.callStatus ??
    body.event ??
    body.event_type ??
    body.hangup_cause ??
    nested?.status ??
    nested?.call_status ??
    nested?.event ??
    '';
  return String(value);
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'no-answer', 'busy']);

function mapProviderStatus(raw: string): string | undefined {
  const status = raw.toLowerCase().replace(/[_\s]+/g, '-');
  if (['no-answer', 'noanswer', 'unanswered', 'missed', 'not-answered'].includes(status)) {
    return 'no-answer';
  }
  if (status === 'busy') return 'busy';
  if (['failed', 'fail', 'error', 'rejected', 'declined', 'canceled', 'cancelled'].includes(status)) {
    return 'failed';
  }
  if (
    status.includes('hangup') ||
    status.includes('disconnect') ||
    status.includes('drop') ||
    ['completed', 'ended', 'call-ended'].includes(status)
  ) {
    return 'completed';
  }
  if (['answered', 'in-progress', 'inprogress', 'connected'].includes(status)) {
    return 'in-progress';
  }
  if (['ringing', 'initiated', 'initiating', 'queued'].includes(status)) return 'ringing';
  return undefined;
}

/** Acefone Dynamic endpoint — must respond within 2000 ms. */
telephonyRouter.post('/voice/endpoint', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const callId = resolveCallId(body);
  const mapped = mapProviderStatus(rawProviderStatus(body));

  if (!callId) {
    return res.status(400).json({ error: 'callId not found in request' });
  }

  const pending = getPendingCall(callId);
  const resolvedCallId = pending?.callId ?? callId;
  const call = await prisma.call.findUnique({ where: { id: resolvedCallId } });
  if (!pending && !call) {
    return res.status(404).json({ error: 'Unknown call' });
  }

  if (mapped && TERMINAL_STATUSES.has(mapped)) {
    emitTelephonyEvent(resolvedCallId, {
      type: 'log',
      level: 'info',
      category: 'smartflo',
      message: `Dynamic endpoint hangup (${mapped})`,
      detail: { keys: Object.keys(body) },
    });
    res.status(200).json({ sucess: true, success: true });
    const session = getCallSession(call?.id ?? resolvedCallId);
    if (session) {
      session.close();
    } else if (call && !TERMINAL_STATUSES.has(call.status)) {
      await prisma.call.update({
        where: { id: call.id },
        data: { status: mapped, endedAt: new Date() },
      }).catch(() => undefined);
      emitTelephonyEvent(call.id, { type: 'status', status: mapped });
      void dispatchCallCompletedWebhook(call.id).catch((err) => {
        console.error('[telephony] call.completed webhook failed', call.id, err);
      });
    }
    return;
  }

  try {
    const wss_url = publicWssUrl(resolvedCallId);
    emitTelephonyEvent(resolvedCallId, {
      type: 'log',
      level: 'info',
      category: 'smartflo',
      message: 'Dynamic endpoint returned wss_url',
    });
    return res.status(200).json({ sucess: true, success: true, wss_url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to build wss_url';
    emitTelephonyEvent(resolvedCallId, { type: 'error', message });
    return res.status(500).json({ error: message });
  }
});

telephonyRouter.get('/calls/:callId/events', handleTelephonySse);

telephonyRouter.get('/transports', (_req, res) => {
  const livekitConfigured = isLivekitSipConfigured();
  const acefoneConfigured = Boolean(
    process.env.ACEFONE_CLICK_TO_CALL_API_KEY?.trim() ||
      process.env.SMARTFLO_CLICK_TO_CALL_API_KEY?.trim(),
  );
  const defaultTransport: 'acefone' | 'livekit_sip' = acefoneConfigured
    ? 'acefone'
    : livekitConfigured
      ? 'livekit_sip'
      : 'acefone';
  const recommended = defaultTransport;
  const defaultReason = acefoneConfigured
    ? 'Acefone is default because Acefone/Smartflo keys are configured.'
    : livekitConfigured
      ? 'Acefone Click-to-Call is not configured — LiveKit SIP is the only available transport.'
      : 'Neither Acefone nor LiveKit SIP is configured. Set Acefone Click-to-Call keys for real phone calls.';

  res.json({
    // Backward-compatible flat fields (OutboundCall.tsx).
    acefone: acefoneConfigured,
    acefoneConfigured,
    livekit_sip: livekitConfigured,
    livekitSipError: livekitSipConfigError(),
    recommended,
    reason: defaultReason,
    defaultTransport,
    acefoneDetail: {
      configured: acefoneConfigured,
      recommended: recommended === 'acefone',
      reason: acefoneConfigured
        ? 'Uses Tata Smartflo Click-to-Call Support API + Voice Bot WSS (not LiveKit SIP).'
        : 'Set ACEFONE_CLICK_TO_CALL_API_KEY (or SMARTFLO_…) and SMARTFLO_API_TOKEN.',
    },
    livekitSipDetail: {
      configured: livekitConfigured,
      recommended: recommended === 'livekit_sip',
      reason: livekitConfigured
        ? 'Uses LiveKit createSipParticipant + outbound SIP trunk + agent-v2. Trunk settings do not affect Acefone calls.'
        : livekitSipConfigError() || 'LiveKit SIP not configured.',
      trunkIdPresent: Boolean(process.env.LIVEKIT_SIP_OUTBOUND_TRUNK?.trim()),
      requiresAgentV2: true,
    },
  });
});

telephonyRouter.post('/outbound-call', async (req, res) => {
  const schema = z.object({
    agentId: z.string().uuid(),
    toNumber: z.string().min(8).max(20),
    prospectName: z.string().optional(),
    contactEmail: z.string().email().optional().or(z.literal('')),
    voicePipeline: z.enum(['agent', 'cascaded', 'openai_realtime', 'gemini_live']).optional(),
    realtimeS2sConfig: z.record(z.string(), z.unknown()).optional(),
    /** acefone = legacy Voice Bot WSS; livekit_sip = Simulator 2.0 agent-v2 path. */
    transport: z.enum(['acefone', 'livekit_sip']).optional(),
    /** Debug: block HTTP until SIP callee answers (LiveKit only). Default false. */
    waitUntilAnswered: z.boolean().optional(),
    /** Debug: omit fromNumber so LiveKit trunk default CLI is used. */
    useDefaultTrunkCallerId: z.boolean().optional(),
    /** Debug: play dialtone/early media while ringing. Default false. */
    playDialtone: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Real phone: Acefone by default. LiveKit SIP only when the client explicitly selects it.
  const acefoneReady = Boolean(
    process.env.ACEFONE_CLICK_TO_CALL_API_KEY?.trim() ||
      process.env.SMARTFLO_CLICK_TO_CALL_API_KEY?.trim(),
  );
  const livekitReady = isLivekitSipConfigured();
  const recommendedTransport: 'acefone' | 'livekit_sip' = acefoneReady
    ? 'acefone'
    : livekitReady
      ? 'livekit_sip'
      : 'acefone';
  let transport: 'acefone' | 'livekit_sip' =
    parsed.data.transport ?? (acefoneReady ? 'acefone' : 'livekit_sip');
  const selectedPath = transport === 'acefone' ? 'acefone_support_api' : 'livekit_sip';
  const waitUntilAnswered = parsed.data.waitUntilAnswered === true;
  const useDefaultTrunkCallerId = parsed.data.useDefaultTrunkCallerId === true;
  const playDialtone = parsed.data.playDialtone === true;
  const rawToMasked = maskPhone(parsed.data.toNumber);
  const normalizedPreview = normalizePhone(parsed.data.toNumber);

  console.info(
    'OUTBOUND_CALL_REQUEST',
    JSON.stringify({
      callId: null,
      transport,
      selectedPath,
      agentId: agent.id,
      toNumberMasked: rawToMasked,
      normalizedNumberMasked: maskPhone(normalizedPreview),
      livekitSipConfigured: livekitReady,
      acefoneConfigured: acefoneReady,
      recommendedTransport,
      waitUntilAnswered: transport === 'livekit_sip' ? waitUntilAnswered : false,
      useDefaultTrunkCallerId: transport === 'livekit_sip' ? useDefaultTrunkCallerId : false,
      playDialtone: transport === 'livekit_sip' ? playDialtone : false,
    }),
  );

  if (transport === 'livekit_sip' && !livekitReady) {
    return res.status(400).json({
      error:
        livekitSipConfigError() ||
        'LiveKit SIP is not configured. Use Acefone for real phone calls, or set LIVEKIT_SIP_OUTBOUND_TRUNK.',
    });
  }
  if (transport === 'acefone' && !acefoneReady) {
    return res.status(400).json({
      error:
        'Acefone / Smartflo Click-to-Call is not configured. Set ACEFONE_CLICK_TO_CALL_API_KEY (or SMARTFLO_…).',
    });
  }

  if (transport === 'livekit_sip') {
    console.info(
      '[telephony] Skipping Acefone path because transport=livekit_sip',
    );
    const cfgErr = livekitSipConfigError();
    if (cfgErr) return res.status(400).json({ error: cfgErr });

    const pipelineMode = normalizeTelephonyPipelineMode(parsed.data.voicePipeline);
    const appliedPipeline = resolveTelephonyAppliedPipeline(pipelineMode, agent.voicePipeline);
    const voicePipeline = normalizeVoicePipeline(
      appliedPipeline === 'openai_realtime' || appliedPipeline === 'gemini_live'
        ? appliedPipeline
        : agent.voicePipeline,
    );

    if (voicePipeline === 'openai_realtime' && !process.env.OPENAI_API_KEY?.trim()) {
      return res.status(400).json({
        error: 'OPENAI_API_KEY is required for OpenAI Realtime S2S on LiveKit SIP calls.',
      });
    }
    if (
      voicePipeline === 'gemini_live' &&
      !process.env.GEMINI_API_KEY?.trim() &&
      !process.env.GOOGLE_API_KEY?.trim()
    ) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY (or GOOGLE_API_KEY) is required for Gemini Live on LiveKit SIP calls.',
      });
    }

    const toNumber = normalizePhone(parsed.data.toNumber);
    const dialNumber =
      toNumber.length === 10
        ? `+91${toNumber}`
        : toNumber.startsWith('+')
          ? toNumber
          : `+${toNumber}`;
    const prospectName = parsed.data.prospectName?.trim() || null;
    const contactEmail = parsed.data.contactEmail?.trim() || null;
    const fromNumber =
      process.env.LIVEKIT_SIP_FROM_NUMBER?.replace(/\D/g, '') ||
      process.env.ACEFONE_FROM_NUMBER?.replace(/\D/g, '') ||
      null;

    const realtimeS2sConfig =
      voicePipeline === 'openai_realtime' || voicePipeline === 'gemini_live'
        ? normalizeRealtimeS2sUserConfig(
            {
              ...((agent.realtimeS2sConfig && typeof agent.realtimeS2sConfig === 'object'
                ? agent.realtimeS2sConfig
                : {}) as Partial<RealtimeS2sUserConfig>),
              ...((parsed.data.realtimeS2sConfig ?? {}) as Partial<RealtimeS2sUserConfig>),
            },
            voicePipeline,
          )
        : undefined;

    const roomName = `call-v2-${agent.id}-${Date.now()}`;
    const call = await prisma.call.create({
      data: {
        agentId: agent.id,
        roomName,
        direction: 'outbound',
        source: 'livekit-sip',
        status: 'initiating',
        provider: 'livekit_sip',
        toNumber,
        fromNumber,
        prospectName,
        contactPhone: toNumber,
        contactEmail,
        transcript: toInputJson({
          v2Session: {
            voicePipeline,
            realtimeVoice: realtimeS2sConfig?.voice ?? agent.realtimeVoice,
            ...(realtimeS2sConfig ? { realtimeS2sConfig } : {}),
          },
          telephonySession: {
            pipelineMode,
            appliedPipeline: voicePipeline,
            transport: 'livekit_sip',
            ...(realtimeS2sConfig ? { realtimeS2sConfig } : {}),
          },
        }),
      },
    });

    const meta = buildLivekitSipSessionMeta({
      agentId: agent.id,
      callId: call.id,
      direction: 'outbound',
      voicePipeline,
      realtimeVoice: realtimeS2sConfig?.voice ?? agent.realtimeVoice ?? undefined,
      realtimeS2sConfig,
      prospectName,
      contactPhone: toNumber,
      contactEmail,
    });

    emitTelephonyEvent(call.id, { type: 'status', status: 'initiating' });
    emitTelephonyEvent(call.id, {
      type: 'log',
      level: 'info',
      category: 'livekit',
      message: `LiveKit SIP dial ${maskPhone(dialNumber)} via agent-v2 (pipeline: ${voicePipeline})`,
    });
    console.info(
      'OUTBOUND_CALL_REQUEST',
      JSON.stringify({
        callId: call.id,
        transport: 'livekit_sip',
        selectedPath: 'livekit_sip',
        agentId: agent.id,
        toNumberMasked: maskPhone(dialNumber),
        normalizedNumberMasked: maskPhone(toNumber),
        livekitSipConfigured: true,
        acefoneConfigured: acefoneReady,
        recommendedTransport,
        waitUntilAnswered,
        useDefaultTrunkCallerId,
        playDialtone,
        roomName,
      }),
    );

    try {
      // Default waitUntilAnswered:false so HTTP returns while ringing / polling continues in background.
      // UI debug checkbox can set true (90s request timeout) to surface SIP reject/no-answer on the API call.
      const { sipParticipantIdentity } = await placeLivekitSipOutbound({
        roomName,
        toNumber: dialNumber,
        roomMetadata: meta.roomMetadata,
        participantMetadata: meta.participantMetadata,
        fromNumber: fromNumber ?? undefined,
        waitUntilAnswered,
        useDefaultTrunkCallerId,
        playDialtone,
        agentId: agent.id,
        callId: call.id,
      });

      const nextStatus = waitUntilAnswered ? 'in-progress' : 'ringing';
      await prisma.call.update({
        where: { id: call.id },
        data: {
          status: nextStatus,
          externalCallId: sipParticipantIdentity,
        },
      });
      emitTelephonyEvent(call.id, { type: 'status', status: nextStatus });
      emitTelephonyEvent(call.id, {
        type: 'log',
        level: 'info',
        category: 'livekit',
        message: waitUntilAnswered
          ? `SIP answered (waitUntilAnswered) → ${maskPhone(dialNumber)} (room ${roomName})`
          : `SIP dial started → ${maskPhone(dialNumber)} (room ${roomName}); polling sip.callStatus in background`,
      });

      return res.json({
        callId: call.id,
        status: nextStatus,
        transport: 'livekit_sip',
        provider: 'livekit_sip',
        roomName,
        selectedPath: 'livekit_sip',
        debugMessage:
          'Using LiveKit SIP outbound. createSipParticipant will be called.',
        voicePipeline,
        pipelineMode,
        realtimeS2sConfig,
        waitUntilAnswered,
        useDefaultTrunkCallerId,
        playDialtone,
        message: waitUntilAnswered
          ? 'LiveKit SIP call answered (debug waitUntilAnswered).'
          : 'LiveKit SIP dial started (agent-v2). Status updates via events while the phone rings.',
      });
    } catch (err) {
      const failure =
        err && typeof err === 'object' && 'livekitSipFailure' in err
          ? (err as { livekitSipFailure: ReturnType<typeof extractLivekitSipFailure> })
              .livekitSipFailure
          : extractLivekitSipFailure(err);
      const dialTimeout = waitUntilAnswered && isLivekitWaitUntilAnsweredTimeout(failure);
      const message = formatLivekitSipFailureReason(failure, { waitUntilAnswered });
      console.error('[telephony] livekit-sip outbound failed', message);
      try {
        await hangupLivekitSipRoom(roomName);
      } catch {
        /* room may not exist */
      }
      const failStatus = dialTimeout ? 'dial_timeout' : 'failed';
      await prisma.call.update({
        where: { id: call.id },
        data: { status: failStatus, endedAt: new Date() },
      });
      emitTelephonyEvent(call.id, { type: 'status', status: failStatus });
      emitTelephonyEvent(call.id, { type: 'error', message });
      return res.status(dialTimeout ? 504 : 500).json({
        error: message,
        callId: call.id,
        transport: 'livekit_sip',
        provider: 'livekit_sip',
        roomName,
        selectedPath: 'livekit_sip',
        status: failStatus,
        debugMessage: dialTimeout
          ? 'waitUntilAnswered timed out before SIP answer — check LiveKit Calls + provider CDR.'
          : 'LiveKit SIP createSipParticipant failed — see LIVEKIT_SIP_CALL_FAILED logs.',
        sipStatusCode: failure.sipStatusCode ?? null,
        sipStatus: failure.sipStatus ?? null,
      });
    }
  }

  console.info(
    '[telephony] Skipping LiveKit SIP path because transport=acefone',
  );
  const pipelineMode = normalizeTelephonyPipelineMode(parsed.data.voicePipeline);
  const appliedPipeline = resolveTelephonyAppliedPipeline(
    pipelineMode,
    agent.voicePipeline,
  );

  if (appliedPipeline === 'openai_realtime' && !process.env.OPENAI_API_KEY?.trim()) {
    return res.status(400).json({
      error: 'OPENAI_API_KEY is required for OpenAI Realtime S2S on phone calls.',
    });
  }

  if (appliedPipeline === 'gemini_live' && !process.env.GEMINI_API_KEY?.trim() && !process.env.GOOGLE_API_KEY?.trim()) {
    return res.status(400).json({
      error: 'GEMINI_API_KEY (or GOOGLE_API_KEY) is required for Gemini Live S2S on phone calls.',
    });
  }

  const toNumber = normalizePhone(parsed.data.toNumber);
  const fromNumber = process.env.ACEFONE_FROM_NUMBER?.replace(/\D/g, '') ?? undefined;
  const prospectName = parsed.data.prospectName?.trim() || null;
  const contactEmail = parsed.data.contactEmail?.trim() || null;

  const realtimeS2sConfig =
    appliedPipeline === 'openai_realtime' || appliedPipeline === 'gemini_live'
      ? normalizeRealtimeS2sUserConfig(
          (parsed.data.realtimeS2sConfig ?? {}) as Partial<RealtimeS2sUserConfig>,
          appliedPipeline,
        )
      : undefined;

  const telephonySession: TelephonyCallSessionPayload = {
    pipelineMode,
    appliedPipeline,
    ...(realtimeS2sConfig ? { realtimeS2sConfig } : {}),
  };

  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      roomName: `telephony-${Date.now()}`,
      direction: 'outbound',
      source: 'click-to-call',
      status: 'initiating',
      provider: 'acefone',
      toNumber,
      fromNumber,
      prospectName,
      contactPhone: toNumber,
      contactEmail,
      transcript: toInputJson({ telephonySession }),
    },
  });

  registerPendingCall({
    callId: call.id,
    agentId: agent.id,
    toNumber,
    fromNumber,
    prospectName: prospectName ?? undefined,
    contactEmail: contactEmail ?? undefined,
    voicePipeline: pipelineMode,
    createdAt: Date.now(),
  });
  const agentPrefetch = prefetchRuntimeAgent(call.id, agent.id, {
    prospectName: prospectName ?? undefined,
    contactPhone: toNumber,
    contactEmail: contactEmail ?? undefined,
    direction: 'outbound',
  });
  warmOutboundOpener(call.id, agentPrefetch, prospectName ?? undefined);
  if (appliedPipeline !== 'openai_realtime' && appliedPipeline !== 'gemini_live') {
    warmTelephonySttForCall(call.id, {
      languages: agent.voiceLanguages,
      sttProvider: agent.sttProvider,
      sttModel: agent.sttModel,
    });
  }

  emitTelephonyEvent(call.id, { type: 'status', status: 'initiating' });
  emitTelephonyEvent(call.id, {
    type: 'log',
    level: 'info',
    category: 'smartflo',
    message: `Placing outbound call to ${maskPhone(toNumber)} (pipeline: ${appliedPipeline}${pipelineMode === 'cascaded' || pipelineMode === 'openai_realtime' || pipelineMode === 'gemini_live' ? ', forced' : ''})`,
  });
  console.info(
    'OUTBOUND_CALL_REQUEST',
    JSON.stringify({
      callId: call.id,
      transport: 'acefone',
      selectedPath: 'acefone_support_api',
      agentId: agent.id,
      toNumberMasked: maskPhone(toNumber),
      normalizedNumberMasked: maskPhone(toNumber),
      livekitSipConfigured: livekitReady,
      acefoneConfigured: true,
      recommendedTransport,
      waitUntilAnswered: false,
      roomName: call.roomName,
    }),
  );

  try {
    const result = await initiateClickToCallSupport({
      customerNumber: toNumber,
      callerId: fromNumber,
      customIdentifier: call.id,
    });

    if (!result.success) {
      dropPrefetchedRuntime(call.id);
      dropWarmedTelephonyStt(call.id);
      await prisma.call.update({
        where: { id: call.id },
        data: { status: 'failed', endedAt: new Date() },
      });
      const message = result.message ?? 'Acefone rejected the call';
      emitTelephonyEvent(call.id, { type: 'status', status: 'failed' });
      emitTelephonyEvent(call.id, { type: 'error', message });
      return res.status(502).json({
        error: message,
        callId: call.id,
        transport: 'acefone',
        provider: 'acefone',
        selectedPath: 'acefone_support_api',
        debugMessage:
          'Using Acefone/Smartflo Click-to-Call Support API. LiveKit SIP createSipParticipant will not be called.',
      });
    }

    await prisma.call.update({
      where: { id: call.id },
      data: { status: 'ringing', externalCallId: result.refId ?? undefined },
    });
    emitTelephonyEvent(call.id, { type: 'status', status: 'ringing' });
    emitTelephonyEvent(call.id, {
      type: 'log',
      level: 'info',
      category: 'smartflo',
      message: result.message ?? 'Originate queued',
      detail: { refId: result.refId },
    });

    return res.json({
      callId: call.id,
      status: 'ringing',
      transport: 'acefone',
      provider: 'acefone',
      roomName: call.roomName,
      selectedPath: 'acefone_support_api',
      debugMessage:
        'Using Acefone/Smartflo Click-to-Call Support API. LiveKit SIP createSipParticipant will not be called.',
      message: result.message ?? 'Call initiated',
      refId: result.refId,
      voicePipeline: appliedPipeline,
      pipelineMode,
      realtimeS2sConfig,
    });
  } catch (err) {
    dropPrefetchedRuntime(call.id);
    dropWarmedTelephonyStt(call.id);
    await prisma.call.update({
      where: { id: call.id },
      data: { status: 'failed', endedAt: new Date() },
    });
    const message = err instanceof Error ? err.message : 'Failed to initiate call';
    console.error('[telephony] outbound-call failed', message);
    emitTelephonyEvent(call.id, { type: 'status', status: 'failed' });
    emitTelephonyEvent(call.id, { type: 'error', message });
    return res.status(500).json({
      error: message,
      callId: call.id,
      transport: 'acefone',
      provider: 'acefone',
      selectedPath: 'acefone_support_api',
    });
  }
});

telephonyRouter.post('/calls/:callId/hangup', async (req, res) => {
  const call = await prisma.call.findUnique({ where: { id: req.params.callId } });
  if (!call) return res.status(404).json({ error: 'Call not found' });

  const session = getCallSession(call.id);
  if (session) {
    await session.requestHangup('ui');
    return res.json({ ok: true, callId: call.id });
  }

  if (call.provider === 'livekit_sip' && call.roomName) {
    emitTelephonyEvent(call.id, {
      type: 'log',
      level: 'info',
      category: 'livekit',
      message: 'Hangup — deleting LiveKit room',
    });
    try {
      await hangupLivekitSipRoom(call.roomName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'LiveKit room delete failed';
      emitTelephonyEvent(call.id, {
        type: 'log',
        level: 'warn',
        category: 'livekit',
        message,
      });
    }
    const terminal = TERMINAL_STATUSES.has(call.status);
    if (!terminal) {
      await prisma.call.update({
        where: { id: call.id },
        data: { status: 'completed', endedAt: new Date() },
      });
      emitTelephonyEvent(call.id, { type: 'status', status: 'completed' });
    }
    void dispatchCallCompletedWebhook(call.id).catch((err) => {
      console.error('[telephony] call.completed webhook failed', call.id, err);
    });
    return res.json({ ok: true, callId: call.id, transport: 'livekit_sip' });
  }

  const callSid = call.externalCallId || undefined;
  emitTelephonyEvent(call.id, {
    type: 'log',
    level: 'info',
    category: 'ws',
    message: 'Conversation complete — hanging up (ui)',
  });

  try {
    // externalCallId may be click-to-call ref_id (UUID) or live callSid (CAGE3-…).
    if (callSid) await hangupSmartfloWithCandidates(callSid);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Hangup API failed';
    console.warn('[telephony] UI hangup failed', call.id, message);
    emitTelephonyEvent(call.id, {
      type: 'log',
      level: 'warn',
      category: 'smartflo',
      message,
    });
  }

  const terminal = TERMINAL_STATUSES.has(call.status);
  if (!terminal) {
    await prisma.call.update({
      where: { id: call.id },
      data: { status: 'completed', endedAt: new Date() },
    });
    emitTelephonyEvent(call.id, { type: 'status', status: 'completed' });
  }

  void dispatchCallCompletedWebhook(call.id).catch((err) => {
    console.error('[telephony] call.completed webhook failed', call.id, err);
  });

  return res.json({ ok: true, callId: call.id });
});

telephonyRouter.post('/webhooks/call-status', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const callId =
    resolveCallId(body) ??
    (typeof body.callSid === 'string' ? body.callSid : undefined);

  const rawStatus = rawProviderStatus(body);
  const mapped = mapProviderStatus(rawStatus);

  console.log('[telephony] Provider webhook', { callId, rawStatus, mapped, keys: Object.keys(body) });
  emitTelephonyEvent(callId ?? 'unknown', {
    type: 'log',
    level: 'info',
    category: 'smartflo',
    message: `Provider webhook: ${rawStatus || 'empty'}`,
    detail: { keys: Object.keys(body), mapped },
  });

  if (!callId || !mapped) {
    return res.json({ ok: true, ignored: true });
  }

  const pending = getPendingCall(callId);
  let resolvedCallId = pending?.callId ?? callId;
  let call = await prisma.call.findUnique({ where: { id: resolvedCallId } });
  if (!call && typeof body.callSid === 'string') {
    call = await prisma.call.findFirst({
      where: { externalCallId: body.callSid },
      orderBy: { startedAt: 'desc' },
    });
    if (call) resolvedCallId = call.id;
  }
  if (!call) return res.json({ ok: true, ignored: true });

  const alreadyTerminal = TERMINAL_STATUSES.has(call.status);
  if (alreadyTerminal && mapped !== 'in-progress') {
    getCallSession(call.id)?.close();
    return res.json({ ok: true, status: call.status });
  }

  if (mapped === 'in-progress' && call.status === 'in-progress') {
    return res.json({ ok: true, status: call.status });
  }

  const ended = TERMINAL_STATUSES.has(mapped);
  await prisma.call.update({
    where: { id: call.id },
    data: {
      status: mapped,
      endedAt: ended ? new Date() : call.endedAt,
      externalCallId:
        (typeof body.callSid === 'string' && body.callSid) ||
        (typeof body.call_id === 'string' && body.call_id) ||
        call.externalCallId,
    },
  });
  emitTelephonyEvent(call.id, { type: 'status', status: mapped });
  if (ended) {
    getCallSession(call.id)?.close();
    void dispatchCallCompletedWebhook(call.id).catch((err) => {
      console.error('[telephony] call.completed webhook failed', call.id, err);
    });
  }
  if (mapped === 'no-answer' || mapped === 'busy' || mapped === 'failed') {
    emitTelephonyEvent(call.id, {
      type: 'error',
      message: mapped === 'busy' ? 'Line busy' : mapped === 'no-answer' ? 'No answer' : 'Call failed',
    });
  }

  return res.json({ ok: true, callId: call.id, status: mapped });
});
