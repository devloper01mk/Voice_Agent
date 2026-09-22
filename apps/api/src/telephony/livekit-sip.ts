/**
 * LiveKit SIP outbound — same agent-v2 path as Simulator 2.0.
 *
 * Requires LIVEKIT_SIP_OUTBOUND_TRUNK (Cloud SIP outbound trunk id) plus
 * LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.
 */
import {
  AgentDispatchClient,
  RoomServiceClient,
  SipClient,
  TwirpError,
} from 'livekit-server-sdk';
import {
  normalizeRealtimeS2sUserConfig,
  normalizeVoicePipeline,
  resolveGeminiLiveVoice,
  resolveRealtimeVoice,
  type RealtimeS2sUserConfig,
  type VoicePipeline,
} from '@vsa/shared';
import type { Simulator2CallSessionPayload } from '../simulator2/session-config.js';

export const AGENT_V2_NAME = 'voice-sales-agent-v2';

const SIP_RINGING_TIMEOUT_SEC = 45;
const SIP_REQUEST_TIMEOUT_FAST_SEC = 20;
const SIP_REQUEST_TIMEOUT_WAIT_MIN_SEC = 90;

export function livekitHttpHost(url: string): string {
  return url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}

export function isLivekitSipConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_SIP_OUTBOUND_TRUNK?.trim() &&
      process.env.LIVEKIT_URL?.trim() &&
      process.env.LIVEKIT_API_KEY?.trim() &&
      process.env.LIVEKIT_API_SECRET?.trim(),
  );
}

export function livekitSipConfigError(): string | null {
  if (!process.env.LIVEKIT_URL?.trim()) return 'LIVEKIT_URL is not configured';
  if (!process.env.LIVEKIT_API_KEY?.trim() || !process.env.LIVEKIT_API_SECRET?.trim()) {
    return 'LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not configured';
  }
  if (!process.env.LIVEKIT_SIP_OUTBOUND_TRUNK?.trim()) {
    return 'LIVEKIT_SIP_OUTBOUND_TRUNK is not configured (LiveKit Cloud → SIP → Outbound trunk)';
  }
  return null;
}

/** Mask phone for logs — keep last 4 digits only. */
export function maskPhone(raw?: string | null): string {
  if (!raw) return '(none)';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export type LivekitSipFailureInfo = {
  errorName: string;
  errorMessage: string;
  sipStatusCode?: string | number;
  sipStatus?: string;
  httpStatus?: number;
  twirpCode?: string;
  isWaitUntilAnsweredTimeout?: boolean;
};

/** True when SDK aborted waitUntilAnswered before a SIP status came back. */
export function isLivekitWaitUntilAnsweredTimeout(info: LivekitSipFailureInfo): boolean {
  if (info.isWaitUntilAnsweredTimeout) return true;
  const name = info.errorName.toLowerCase();
  const msg = info.errorMessage.toLowerCase();
  return (
    name.includes('timeout') ||
    msg.includes('aborted due to timeout') ||
    msg.includes('operation was aborted')
  );
}

/** Extract SIP / Twirp failure fields without relying on a SipCallError export. */
export function extractLivekitSipFailure(err: unknown): LivekitSipFailureInfo {
  const errorName =
    err instanceof Error
      ? err.name || err.constructor?.name || 'Error'
      : typeof err;
  const errorMessage = err instanceof Error ? err.message : String(err);
  const info: LivekitSipFailureInfo = { errorName, errorMessage };

  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const meta =
      e.metadata && typeof e.metadata === 'object'
        ? (e.metadata as Record<string, unknown>)
        : undefined;

    const pick = (...keys: string[]): string | number | undefined => {
      for (const key of keys) {
        const v = e[key] ?? meta?.[key];
        if (typeof v === 'string' || typeof v === 'number') return v;
      }
      return undefined;
    };

    const sipStatusCode = pick(
      'sipStatusCode',
      'sip_status_code',
      'statusCode',
      'status_code',
    );
    const sipStatus = pick('sipStatus', 'sip_status', 'status');
    if (sipStatusCode != null) info.sipStatusCode = sipStatusCode;
    if (typeof sipStatus === 'string') info.sipStatus = sipStatus;

    if (err instanceof TwirpError) {
      info.httpStatus = err.status;
      if (err.code) info.twirpCode = err.code;
      const m = err.metadata;
      if (m) {
        if (m.sip_status_code && info.sipStatusCode == null) info.sipStatusCode = m.sip_status_code;
        if (m.sipStatusCode && info.sipStatusCode == null) info.sipStatusCode = m.sipStatusCode;
        if (m.sip_status && info.sipStatus == null) info.sipStatus = m.sip_status;
        if (m.sipStatus && info.sipStatus == null) info.sipStatus = m.sipStatus;
      }
    } else if (typeof e.status === 'number') {
      info.httpStatus = e.status;
    }
  }

  if (isLivekitWaitUntilAnsweredTimeout(info)) {
    info.isWaitUntilAnsweredTimeout = true;
  }

  return info;
}

export function formatLivekitSipFailureReason(
  info: LivekitSipFailureInfo,
  opts?: { waitUntilAnswered?: boolean },
): string {
  if (opts?.waitUntilAnswered && isLivekitWaitUntilAnsweredTimeout(info)) {
    return 'LiveKit SIP waitUntilAnswered timed out before answer. Check LiveKit Calls and provider CDR.';
  }
  const code = info.sipStatusCode ?? info.httpStatus;
  const status = info.sipStatus ?? info.twirpCode;
  if (code != null || status) {
    return `LiveKit SIP failed: ${code ?? '?'}${status ? ` ${status}` : ''} — ${info.errorMessage}`;
  }
  return `LiveKit SIP failed: ${info.errorMessage}`;
}

function clients() {
  const url = livekitHttpHost(process.env.LIVEKIT_URL!);
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  return {
    rooms: new RoomServiceClient(url, apiKey, apiSecret),
    sip: new SipClient(url, apiKey, apiSecret),
    dispatch: new AgentDispatchClient(url, apiKey, apiSecret),
    trunkId: process.env.LIVEKIT_SIP_OUTBOUND_TRUNK!.trim(),
  };
}

function resolveRequestTimeoutSec(waitUntilAnswered: boolean, ringingTimeout: number): number {
  if (!waitUntilAnswered) return SIP_REQUEST_TIMEOUT_FAST_SEC;
  return Math.max(SIP_REQUEST_TIMEOUT_WAIT_MIN_SEC, ringingTimeout + 30);
}

/**
 * After a fast createSipParticipant (waitUntilAnswered=false), poll room participants
 * so we can see sip.callStatus without blocking the HTTP dial response.
 */
async function pollSipParticipantAttributes(opts: {
  roomName: string;
  participantIdentity: string;
  callId?: string;
}): Promise<void> {
  const { rooms } = clients();
  const deadline = Date.now() + 60_000;
  let lastStatus = '';

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      const participants = await rooms.listParticipants(opts.roomName);
      const match = participants.find((p) => p.identity === opts.participantIdentity);
      if (!match) {
        console.info(
          'LIVEKIT_SIP_PARTICIPANT_POLL',
          JSON.stringify({
            roomName: opts.roomName,
            callId: opts.callId ?? null,
            participantIdentity: opts.participantIdentity,
            found: false,
          }),
        );
        continue;
      }

      const attrs = match.attributes ?? {};
      const sipCallStatus = (attrs['sip.callStatus'] ?? '').toLowerCase().trim();
      const snapshot = {
        roomName: opts.roomName,
        callId: opts.callId ?? null,
        participantIdentity: opts.participantIdentity,
        found: true,
        sipCallStatus: attrs['sip.callStatus'] ?? null,
        sipCallID: attrs['sip.callID'] ?? null,
        sipTrunkID: attrs['sip.trunkID'] ?? attrs['sip.trunkId'] ?? null,
        sipPhoneNumber: attrs['sip.phoneNumber'] ?? null,
      };

      if (sipCallStatus !== lastStatus) {
        console.info('LIVEKIT_SIP_PARTICIPANT_POLL', JSON.stringify(snapshot));
        lastStatus = sipCallStatus;
      }

      if (
        sipCallStatus === 'active' ||
        sipCallStatus === 'automation' ||
        sipCallStatus === 'hangup' ||
        sipCallStatus === 'disconnected' ||
        sipCallStatus === 'error'
      ) {
        console.info(
          'LIVEKIT_SIP_PARTICIPANT_POLL_DONE',
          JSON.stringify({ ...snapshot, reason: `status=${sipCallStatus || 'empty'}` }),
        );
        return;
      }
    } catch (err) {
      console.warn(
        'LIVEKIT_SIP_PARTICIPANT_POLL_ERROR',
        JSON.stringify({
          roomName: opts.roomName,
          errorMessage: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  console.info(
    'LIVEKIT_SIP_PARTICIPANT_POLL_DONE',
    JSON.stringify({
      roomName: opts.roomName,
      callId: opts.callId ?? null,
      participantIdentity: opts.participantIdentity,
      reason: 'poll_timeout_60s',
      lastStatus: lastStatus || null,
    }),
  );
}

export function buildLivekitSipSessionMeta(input: {
  agentId: string;
  callId: string;
  direction: 'inbound' | 'outbound';
  voicePipeline: VoicePipeline;
  realtimeVoice?: string;
  realtimeS2sConfig?: RealtimeS2sUserConfig;
  prospectName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}): { roomMetadata: string; participantMetadata: string; v2Session: Simulator2CallSessionPayload } {
  const voicePipeline = normalizeVoicePipeline(input.voicePipeline);
  let realtimeS2sConfig = input.realtimeS2sConfig;
  const realtimeVoice =
    voicePipeline === 'gemini_live'
      ? resolveGeminiLiveVoice(realtimeS2sConfig?.voice ?? input.realtimeVoice)
      : resolveRealtimeVoice(realtimeS2sConfig?.voice ?? input.realtimeVoice);
  if (realtimeS2sConfig) {
    realtimeS2sConfig = normalizeRealtimeS2sUserConfig(
      { ...realtimeS2sConfig, voice: realtimeVoice },
      voicePipeline === 'openai_realtime' || voicePipeline === 'gemini_live'
        ? voicePipeline
        : undefined,
    );
  }

  const payload = {
    agentId: input.agentId,
    callId: input.callId,
    direction: input.direction,
    simulatorVersion: '2.0',
    source: 'livekit_sip',
    voicePipeline,
    realtimeVoice,
    ...(realtimeS2sConfig
      ? {
          realtimeS2sConfig,
          s2sVoice: realtimeS2sConfig.voice,
          s2sModel: realtimeS2sConfig.model,
        }
      : {}),
    ...(input.prospectName ? { prospectName: input.prospectName } : {}),
    ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
    ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
  };

  const v2Session: Simulator2CallSessionPayload = {
    voicePipeline,
    realtimeVoice,
    ...(realtimeS2sConfig ? { realtimeS2sConfig } : {}),
  };

  const json = JSON.stringify(payload);
  return { roomMetadata: json, participantMetadata: json, v2Session };
}

/** Create room, dispatch agent-v2, dial PSTN via SIP trunk. */
export async function placeLivekitSipOutbound(opts: {
  roomName: string;
  toNumber: string;
  roomMetadata: string;
  participantMetadata: string;
  fromNumber?: string;
  waitUntilAnswered?: boolean;
  /** When true, omit fromNumber so LiveKit trunk default CLI is used. */
  useDefaultTrunkCallerId?: boolean;
  /** When true, play dialtone/early media while ringing. Default false (avoids audio-track confusion). */
  playDialtone?: boolean;
  agentId?: string;
  callId?: string;
}): Promise<{
  sipParticipantIdentity: string;
  participantSid?: string;
  sipCallId?: string;
}> {
  const { rooms, sip, dispatch, trunkId } = clients();
  const waitUntilAnswered = opts.waitUntilAnswered === true;
  const useDefaultTrunkCallerId = opts.useDefaultTrunkCallerId === true;
  const playDialtone = opts.playDialtone === true;
  const ringingTimeout = SIP_RINGING_TIMEOUT_SEC;
  const requestTimeout = resolveRequestTimeoutSec(waitUntilAnswered, ringingTimeout);
  const fromNumberMode = useDefaultTrunkCallerId ? 'trunk_default' : 'explicit';

  const explicitFrom =
    opts.fromNumber?.replace(/\D/g, '') ||
    process.env.LIVEKIT_SIP_FROM_NUMBER?.replace(/\D/g, '') ||
    process.env.ACEFONE_FROM_NUMBER?.replace(/\D/g, '') ||
    undefined;
  const fromNumber = useDefaultTrunkCallerId ? undefined : explicitFrom;

  console.info(
    'LIVEKIT_ROOM_CREATE_REQUEST',
    JSON.stringify({
      roomName: opts.roomName,
      agentId: opts.agentId ?? null,
      callId: opts.callId ?? null,
    }),
  );

  await rooms.createRoom({
    name: opts.roomName,
    emptyTimeout: 90,
    departureTimeout: 20,
    metadata: opts.roomMetadata,
  });

  console.info(
    'LIVEKIT_ROOM_CREATED',
    JSON.stringify({
      roomName: opts.roomName,
    }),
  );

  console.info(
    'LIVEKIT_AGENT_DISPATCH_REQUEST',
    JSON.stringify({
      roomName: opts.roomName,
      agentName: AGENT_V2_NAME,
    }),
  );

  const dispatchInfo = await dispatch.createDispatch(opts.roomName, AGENT_V2_NAME, {
    metadata: opts.roomMetadata,
  });

  console.info(
    'LIVEKIT_AGENT_DISPATCH_CREATED',
    JSON.stringify({
      roomName: opts.roomName,
      dispatchId: dispatchInfo?.id ?? null,
      agentName: AGENT_V2_NAME,
    }),
  );

  const identity = `sip-${opts.toNumber.replace(/\D/g, '')}`;

  console.info(
    'LIVEKIT_SIP_OPTIONS_FINAL',
    JSON.stringify({
      waitUntilAnswered,
      ringingTimeout,
      timeout: requestTimeout,
      fromNumberMode,
      playDialtone,
    }),
  );

  console.info(
    'LIVEKIT_SIP_PARTICIPANT_CREATE_REQUEST',
    JSON.stringify({
      roomName: opts.roomName,
      sipTrunkId: trunkId,
      sipCallToMasked: maskPhone(opts.toNumber),
      fromNumberMasked: useDefaultTrunkCallerId ? '(trunk_default)' : maskPhone(fromNumber),
      fromNumberMode,
      participantIdentity: identity,
      waitUntilAnswered,
      playDialtone,
      ringingTimeout,
      timeout: requestTimeout,
    }),
  );

  try {
    const participant = await sip.createSipParticipant(trunkId, opts.toNumber, opts.roomName, {
      participantIdentity: identity,
      participantName: opts.toNumber,
      participantMetadata: opts.participantMetadata,
      ...(fromNumber ? { fromNumber } : {}),
      playDialtone,
      waitUntilAnswered,
      // Agent applies Telephony BVC — do not double-Krisp on the trunk.
      krispEnabled: false,
      ringingTimeout,
      maxCallDuration: 60 * 30,
      timeout: requestTimeout,
    });

    console.info(
      'LIVEKIT_SIP_PARTICIPANT_CREATED',
      JSON.stringify({
        roomName: opts.roomName,
        participantIdentity: participant?.participantIdentity || identity,
        participantSid: participant?.participantId || null,
        sipCallId: participant?.sipCallId || null,
        sipCallStatus: waitUntilAnswered ? 'answered_or_completed_wait' : 'dialing',
        waitUntilAnswered,
      }),
    );

    const sipParticipantIdentity = participant?.participantIdentity || identity;

    // Fast path: return immediately; poll sip.callStatus in the background.
    if (!waitUntilAnswered) {
      void pollSipParticipantAttributes({
        roomName: opts.roomName,
        participantIdentity: sipParticipantIdentity,
        callId: opts.callId,
      });
    }

    return {
      sipParticipantIdentity,
      participantSid: participant?.participantId || undefined,
      sipCallId: participant?.sipCallId || undefined,
    };
  } catch (err) {
    const failure = extractLivekitSipFailure(err);
    if (waitUntilAnswered && isLivekitWaitUntilAnsweredTimeout(failure)) {
      failure.isWaitUntilAnsweredTimeout = true;
    }
    console.error(
      'LIVEKIT_SIP_CALL_FAILED',
      JSON.stringify({
        roomName: opts.roomName,
        sipStatusCode: failure.sipStatusCode ?? null,
        sipStatus: failure.sipStatus ?? null,
        httpStatus: failure.httpStatus ?? null,
        twirpCode: failure.twirpCode ?? null,
        errorName: failure.errorName,
        errorMessage: failure.errorMessage,
        waitUntilAnswered,
        isWaitUntilAnsweredTimeout: Boolean(failure.isWaitUntilAnsweredTimeout),
      }),
    );
    const enriched = new Error(formatLivekitSipFailureReason(failure, { waitUntilAnswered }));
    (enriched as Error & { livekitSipFailure?: LivekitSipFailureInfo }).livekitSipFailure = failure;
    throw enriched;
  }
}

export async function hangupLivekitSipRoom(roomName: string): Promise<void> {
  const { rooms } = clients();
  await rooms.deleteRoom(roomName);
}
