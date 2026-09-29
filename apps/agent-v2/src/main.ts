import './load-env.js';
import { ServerOptions, cli, defineAgent, voice } from '@livekit/agents';
import {
  ParticipantKind,
  RoomEvent,
  type Participant,
  type RemoteParticipant,
  type Room,
} from '@livekit/rtc-node';
import {
  buildOutboundOpenerInstructions,
  normalizeRealtimeS2sUserConfig,
  realtimeS2sUserConfigToSessionConfig,
} from '@vsa/shared';
import { fileURLToPath } from 'node:url';
import { attachCallTelemetry, publishSessionConfig } from './call-telemetry.js';
import { attachCallTranscriptPersist } from './call-transcript.js';
import { attachRepeatSpeechGuard } from './repeat-speech-guard.js';
import { attachResponseWatchdog } from './response-watchdog.js';
import { attachSessionGuards } from './session-guards.js';
import { attachSilenceWatchdog } from './silence-watchdog.js';
import { getLatencyConfig } from './latency-profile.js';
import { resolveAgentFromRoom } from './load-agent.js';
import { resolveNoiseCancellation } from './noise-cancellation.js';
import { createVoiceAgent } from './voice-agent.js';
import { apiFetch } from './api-fetch.js';

type SipAnswerResult = {
  answered: boolean;
  status: string | null;
  reason: 'active' | 'timeout' | 'hangup' | 'participant_missing' | 'call_failed';
  participantIdentity?: string;
};

async function patchCallStatus(callId: string, status: string): Promise<void> {
  const res = await apiFetch(`/api/calls/${callId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/calls/${callId} → ${res.status}`);
  }
}

function callIdFromMetadata(...raws: Array<string | undefined>): string | undefined {
  for (const raw of raws) {
    if (!raw?.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as { callId?: unknown };
      if (typeof parsed.callId === 'string' && parsed.callId.trim()) return parsed.callId.trim();
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function resolveRoomName(ctx: {
  room: Room;
  job: { room?: { name?: string } };
}): string {
  return ctx.room.name?.trim() || ctx.job.room?.name?.trim() || '';
}

function isSipParticipant(participant: Participant): boolean {
  const kind = String(participant.kind ?? '');
  const attrs = participant.attributes ?? {};
  return (
    kind.toUpperCase().includes('SIP') ||
    participant.kind === ParticipantKind.SIP ||
    Boolean(attrs['sip.callID'] || attrs['sip.trunkPhoneNumber'] || attrs['sip.callStatus'])
  );
}

function sipStatusOf(participant: Participant): string {
  return (participant.attributes?.['sip.callStatus'] ?? '').toLowerCase().trim();
}

function sipAttr(participant: Participant, key: string): string | null {
  const v = participant.attributes?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Only sip.callStatus === "active" means the customer answered. Never use audio tracks. */
function isSipAnsweredStatus(status: string): boolean {
  return status === 'active';
}

function isSipTerminalHangup(status: string): boolean {
  return status === 'hangup' || status === 'disconnected';
}

function isSipCallFailed(status: string): boolean {
  return status === 'error' || status === 'failed';
}

/**
 * Wait until SIP callee is active. Do NOT treat audio tracks as answered.
 * dialing / ringing / empty status keep waiting until timeout.
 */
async function waitForSipAnswered(
  room: Room,
  participant: RemoteParticipant | Participant,
  opts: { roomName: string; timeoutMs?: number },
): Promise<SipAnswerResult> {
  const identity = participant.identity;
  const roomName = opts.roomName;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  if (!isSipParticipant(participant)) {
    return {
      answered: true,
      status: null,
      reason: 'active',
      participantIdentity: identity,
    };
  }

  const startedAt = Date.now();
  let lastLoggedStatus = '';

  const snapshot = (): {
    found: boolean;
    status: string;
    sipCallId: string | null;
    sipTrunkId: string | null;
  } => {
    const fresh = room.remoteParticipants.get(identity);
    if (!fresh) {
      return { found: false, status: '', sipCallId: null, sipTrunkId: null };
    }
    return {
      found: true,
      status: sipStatusOf(fresh),
      sipCallId: sipAttr(fresh, 'sip.callID') ?? sipAttr(fresh, 'sip.callId'),
      sipTrunkId:
        sipAttr(fresh, 'sip.trunkID') ??
        sipAttr(fresh, 'sip.trunkId') ??
        sipAttr(fresh, 'sip.trunkPhoneNumber'),
    };
  };

  const logPoll = (snap: ReturnType<typeof snapshot>) => {
    console.info(
      'AGENT_V2_SIP_STATUS_POLL',
      JSON.stringify({
        roomName,
        participantIdentity: identity,
        sipCallStatus: snap.status || null,
        sipCallId: snap.sipCallId,
        sipTrunkId: snap.sipTrunkId,
        participantFound: snap.found,
        elapsedMs: Date.now() - startedAt,
      }),
    );
    lastLoggedStatus = snap.status;
  };

  return await new Promise<SipAnswerResult>((resolve) => {
    let settled = false;
    const finish = (result: SipAnswerResult) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      room.off(RoomEvent.ParticipantAttributesChanged, onAttrs);
      room.off(RoomEvent.ParticipantDisconnected, onDisc);
      resolve(result);
    };

    const evaluate = (): void => {
      if (settled) return;
      const snap = snapshot();
      if (snap.status !== lastLoggedStatus || !snap.found) {
        logPoll(snap);
      }

      if (!snap.found) {
        finish({
          answered: false,
          status: lastLoggedStatus || null,
          reason: 'participant_missing',
          participantIdentity: identity,
        });
        return;
      }

      if (isSipAnsweredStatus(snap.status)) {
        finish({
          answered: true,
          status: snap.status,
          reason: 'active',
          participantIdentity: identity,
        });
        return;
      }

      if (isSipTerminalHangup(snap.status)) {
        finish({
          answered: false,
          status: snap.status,
          reason: 'hangup',
          participantIdentity: identity,
        });
        return;
      }

      if (isSipCallFailed(snap.status)) {
        finish({
          answered: false,
          status: snap.status,
          reason: 'call_failed',
          participantIdentity: identity,
        });
        return;
      }

      // dialing | ringing | empty → keep waiting
      if (Date.now() - startedAt >= timeoutMs) {
        finish({
          answered: false,
          status: snap.status || null,
          reason: 'timeout',
          participantIdentity: identity,
        });
      }
    };

    const onAttrs = (_changed: Record<string, string>, p: Participant) => {
      if (p.identity !== identity) return;
      evaluate();
    };
    const onDisc = (p: RemoteParticipant) => {
      if (p.identity !== identity) return;
      finish({
        answered: false,
        status: sipStatusOf(p) || lastLoggedStatus || null,
        reason: 'hangup',
        participantIdentity: identity,
      });
    };

    room.on(RoomEvent.ParticipantAttributesChanged, onAttrs);
    room.on(RoomEvent.ParticipantDisconnected, onDisc);

    // Immediate + 1.5s poll (no audio-track shortcut).
    evaluate();
    const timer = setInterval(evaluate, 1_500);
  });
}

type LoadedCall = Awaited<ReturnType<typeof resolveAgentFromRoom>>;

type LiveCall = {
  session: voice.AgentSession;
  room: Room;
  resolved: LoadedCall;
  bookingLock: ReturnType<typeof createVoiceAgent>['bookingLock'];
  agentGender: ReturnType<typeof createVoiceAgent>['agentGender'];
};

/** Connect Gemini. When holdUntilAnswer, mic and speaker stay off until pickup. */
async function beginVoiceSession(opts: {
  room: Room;
  roomName: string;
  telephony: boolean;
  resolved: LoadedCall;
  holdUntilAnswer: boolean;
}): Promise<LiveCall> {
  const { room, roomName, telephony, resolved, holdUntilAnswer } = opts;
  const { agent, callId, direction, prospectName, contactPhone, contactEmail } = resolved;

  console.info(
    'AGENT_SESSION_STARTING',
    JSON.stringify({
      roomName,
      callId: callId ?? null,
      telephony,
      holdUntilAnswer,
      voicePipeline: agent.voicePipeline ?? null,
    }),
  );

  const latency = getLatencyConfig({ telephony });
  const session = new voice.AgentSession({
    turnHandling: {
      turnDetection: 'realtime_llm',
      interruption: {
        minDuration: latency.interruption.minDuration,
        minWords: latency.interruption.minWords,
        resumeFalseInterruption: latency.interruption.resumeFalseInterruption,
        falseInterruptionTimeout: latency.interruption.falseInterruptionTimeout,
      },
    },
    aecWarmupDuration: telephony ? latency.aecWarmupDuration : undefined,
    ttsReadIdleTimeout: 20_000,
    // LiveKit's 15s "user away" nudge made the agent speak again with nobody talking.
    userAwayTimeout: telephony ? null : undefined,
  });

  const { agent: voiceAgent, bookingLock, agentGender } = createVoiceAgent(
    agent,
    callId,
    direction,
    prospectName,
    contactPhone,
    contactEmail,
    room,
    { telephony },
  );

  await session.start({
    agent: voiceAgent,
    room,
    inputOptions: {
      audioSampleRate: 16000,
      audioNumChannels: 1,
      noiseCancellation: resolveNoiseCancellation({ telephony }),
      deleteRoomOnClose: !holdUntilAnswer,
    },
  });

  if (holdUntilAnswer) {
    session.input.setAudioEnabled(false);
    session.output.setAudioEnabled(false);
    console.info('[vsa] Gemini preconnected during ring — audio held until answer');
  }

  console.info(
    'AGENT_SESSION_STARTED',
    JSON.stringify({
      roomName,
      callId: callId ?? null,
      telephony,
      held: holdUntilAnswer,
    }),
  );

  const s2sConfig =
    agent.realtimeS2sConfig ??
    normalizeRealtimeS2sUserConfig({ voice: agent.realtimeVoice }, 'gemini_live');
  publishSessionConfig(room, {
    callId,
    direction,
    agentName: agent.name,
    realtimeS2s: realtimeS2sUserConfigToSessionConfig(s2sConfig, 'studio_default', 'gemini_live'),
    appliedVoice: s2sConfig.voice,
  });
  console.info(
    `[vsa] Gemini Live S2S started — voice=${s2sConfig.voice} model=${s2sConfig.model}${telephony ? ' telephony=1' : ''}`,
  );

  return { session, room, resolved, bookingLock, agentGender };
}

function attachLiveCallGuards(live: LiveCall): void {
  const { session, room, resolved, bookingLock, agentGender } = live;
  const { agent, callId } = resolved;
  attachCallTelemetry(session, room);
  attachCallTranscriptPersist(session, room, callId);
  attachSilenceWatchdog(session, agent.skillsConfig, {
    agentName: agent.name,
    productName: agent.productName,
  });
  attachResponseWatchdog(session, { agentGender });
  attachRepeatSpeechGuard(session);
  attachSessionGuards(session, { bookingLock, agentGender });
}

async function speakOutboundOpener(
  session: voice.AgentSession,
  resolved: LoadedCall,
): Promise<void> {
  if (resolved.direction !== 'outbound') return;
  let callerSpoke = false;
  const onItem = (ev: { item?: { role?: string; textContent?: string | null } }) => {
    const text = (ev.item?.textContent ?? '').trim();
    if (ev.item?.role === 'user' && text && !text.startsWith('[SYSTEM:')) callerSpoke = true;
  };
  const onSpeech = (ev: { userInitiated: boolean; speechHandle: { interrupt: (force?: boolean) => unknown } }) => {
    if (callerSpoke || ev.userInitiated) return;
    console.warn('OPENER_HOLD', 'dropped extra speech before the caller answered the greeting');
    ev.speechHandle.interrupt(true);
  };
  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, onItem as never);
  session.on(voice.AgentSessionEventTypes.SpeechCreated, onSpeech as never);
  try {
    await session
      .generateReply({
        instructions: buildOutboundOpenerInstructions(resolved.agent, resolved.prospectName),
        allowInterruptions: true,
        toolChoice: 'none',
      })
      .waitForPlayout();
  } catch (err) {
    console.warn(
      '[vsa] Outbound opener generateReply failed — model should greet on first caller audio:',
      err instanceof Error ? err.message : err,
    );
  }
  // The extra city question starts as soon as the greeting ends. After a short beat, stop
  // interrupting — a later reply to the real caller must be allowed.
  setTimeout(() => {
    session.off(voice.AgentSessionEventTypes.ConversationItemAdded, onItem as never);
    session.off(voice.AgentSessionEventTypes.SpeechCreated, onSpeech as never);
  }, 2_500).unref?.();
}

export default defineAgent({
  entry: async (ctx) => {
    // Prefer job room name before connect — ctx.room.name can still be empty early.
    let roomName = resolveRoomName(ctx);
    console.info(
      'AGENT_V2_JOB_RECEIVED',
      JSON.stringify({
        roomName: roomName || null,
        agentName: 'voice-sales-agent-v2',
      }),
    );

    await ctx.connect();
    roomName = resolveRoomName(ctx) || roomName;

    const participant = await ctx.waitForParticipant();
    const telephony = isSipParticipant(participant);

    const loadCall = () =>
      resolveAgentFromRoom(roomName, ctx.room.metadata, participant.metadata);

    if (telephony) {
      console.info(
        'AGENT_V2_WAITING_FOR_SIP_ANSWER',
        JSON.stringify({
          roomName,
          participantIdentity: participant.identity,
          sipCallStatus: sipStatusOf(participant) || null,
        }),
      );

      // Prompt + Gemini connect while the phone is still ringing. Audio stays
      // held so ringback is not heard and nothing is spoken before answer.
      const preconnect = loadCall()
        .then((resolved) =>
          beginVoiceSession({
            room: ctx.room,
            roomName,
            telephony: true,
            resolved,
            holdUntilAnswer: true,
          }),
        )
        .catch((err) => {
          console.warn(
            '[vsa] Ring preconnect failed — will start after answer:',
            err instanceof Error ? err.message : err,
          );
          return null;
        });

      const sipResult = await waitForSipAnswered(ctx.room, participant, { roomName });

      if (!sipResult.answered) {
        const warm = await preconnect;
        if (warm) {
          try {
            await warm.session.close();
          } catch (err) {
            console.warn(
              '[vsa] Failed to close preconnected session after non-answer',
              err instanceof Error ? err.message : err,
            );
          }
        }
        if (sipResult.reason === 'timeout') {
          console.warn(
            'AGENT_V2_SIP_ANSWER_TIMEOUT',
            JSON.stringify({
              roomName,
              participantIdentity: sipResult.participantIdentity ?? participant.identity,
              lastSipCallStatus: sipResult.status,
            }),
          );
        } else {
          console.warn(
            'AGENT_V2_SIP_NOT_ANSWERED',
            JSON.stringify({
              roomName,
              participantIdentity: sipResult.participantIdentity ?? participant.identity,
              reason: sipResult.reason,
              lastSipCallStatus: sipResult.status,
            }),
          );
        }

        const callId = callIdFromMetadata(ctx.room.metadata, participant.metadata);
        const failStatus =
          sipResult.reason === 'timeout'
            ? 'no-answer'
            : sipResult.reason === 'call_failed'
              ? 'failed'
              : 'no-answer';
        if (callId) {
          try {
            await patchCallStatus(callId, failStatus);
          } catch (err) {
            console.warn(
              '[vsa] Failed to patch call status after SIP non-answer',
              err instanceof Error ? err.message : err,
            );
          }
        }

        try {
          await ctx.deleteRoom(roomName || undefined);
        } catch (err) {
          console.warn(
            '[vsa] deleteRoom after SIP non-answer failed',
            err instanceof Error ? err.message : err,
          );
        }
        ctx.shutdown(`sip_not_answered:${sipResult.reason}`);
        return;
      }

      console.info(
        'CUSTOMER_ANSWERED',
        JSON.stringify({
          roomName,
          participantIdentity: sipResult.participantIdentity ?? participant.identity,
          sipCallStatus: sipResult.status,
        }),
      );

      const warm = await preconnect;
      const live = warm ?? (await beginVoiceSession({
        room: ctx.room,
        roomName,
        telephony: true,
        resolved: await loadCall(),
        holdUntilAnswer: false,
      }));
      if (warm) {
        live.session.input.setAudioEnabled(true);
        live.session.output.setAudioEnabled(true);
        const io = (live.session as { _roomIO?: { inputOptions: { deleteRoomOnClose: boolean } } })
          ._roomIO;
        if (io) io.inputOptions.deleteRoomOnClose = true;
        console.info('[vsa] SIP answered — preconnected Gemini unmuted');
      }
      if (live.resolved.callId) {
        void patchCallStatus(live.resolved.callId, 'in-progress').catch((err) => {
          console.warn(
            '[vsa] Failed to mark call in-progress',
            err instanceof Error ? err.message : err,
          );
        });
      }
      attachLiveCallGuards(live);
      await speakOutboundOpener(live.session, live.resolved);
      return;
    }

    const resolved = await loadCall();
    const live = await beginVoiceSession({
      room: ctx.room,
      roomName,
      telephony: false,
      resolved,
      holdUntilAnswer: false,
    });
    attachLiveCallGuards(live);
    await speakOutboundOpener(live.session, live.resolved);
  },
});

async function boot() {
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!geminiKey) {
    console.error(
      '[vsa] GEMINI_API_KEY (or GOOGLE_API_KEY) is required — Gemini Live is the only voice pipeline',
    );
  } else {
    console.info('[vsa] Gemini Live voice pipeline ready');
  }

  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: 'voice-sales-agent-v2',
    }),
  );
}

void boot();
