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
  isGeminiLivePipeline,
  isS2sPipeline,
  normalizeRealtimeS2sUserConfig,
  normalizeSttProvider,
  parseVoiceLanguages,
  realtimeS2sUserConfigToSessionConfig,
} from '@vsa/shared';
import { fileURLToPath } from 'node:url';
import { startAmbientAudio } from './ambient-audio.js';
import { probeAzureSpeechKey } from './azure-stt.js';
import { attachCallTelemetry, publishCallError, publishSessionConfig } from './call-telemetry.js';
import { attachCallTranscriptPersist } from './call-transcript.js';
import { attachSilenceWatchdog } from './silence-watchdog.js';
import { createCallVad } from './call-vad.js';
import { getLatencyConfig } from './latency-profile.js';
import { resolveAgentFromRoom } from './load-agent.js';
import { createStt } from './stt-factory.js';
import { probeSarvamApiKey } from './sarvam-stt.js';
import { resolveNoiseCancellation } from './noise-cancellation.js';
import { createVoiceAgent } from './voice-agent.js';

type SipAnswerResult = {
  answered: boolean;
  status: string | null;
  reason: 'active' | 'timeout' | 'hangup' | 'participant_missing' | 'call_failed';
  participantIdentity?: string;
};

async function patchCallStatus(callId: string, status: string): Promise<void> {
  const apiUrl = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
  const res = await fetch(`${apiUrl}/api/calls/${callId}`, {
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

    if (telephony) {
      console.info(
        'AGENT_V2_WAITING_FOR_SIP_ANSWER',
        JSON.stringify({
          roomName,
          participantIdentity: participant.identity,
          sipCallStatus: sipStatusOf(participant) || null,
        }),
      );

      const sipResult = await waitForSipAnswered(ctx.room, participant, { roomName });

      if (!sipResult.answered) {
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

        // Do not start AgentSession / greeting while still dialing or unanswered.
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

      // Strict: only log CUSTOMER_ANSWERED when status is active.
      console.info(
        'CUSTOMER_ANSWERED',
        JSON.stringify({
          roomName,
          participantIdentity: sipResult.participantIdentity ?? participant.identity,
          sipCallStatus: sipResult.status,
        }),
      );
      console.info('[vsa] SIP answered (active) — starting agent session');
    }

    const { agent, callId, direction, prospectName, contactPhone, contactEmail } =
      await resolveAgentFromRoom(
        roomName,
        ctx.room.metadata,
        participant.metadata,
      );

    if (telephony && callId) {
      void patchCallStatus(callId, 'in-progress').catch((err) => {
        console.warn(
          '[vsa] Failed to mark call in-progress',
          err instanceof Error ? err.message : err,
        );
      });
    }

    console.info(
      'AGENT_SESSION_STARTING',
      JSON.stringify({
        roomName,
        callId: callId ?? null,
        telephony,
        voicePipeline: agent.voicePipeline ?? null,
      }),
    );

    const speakLanguages = parseVoiceLanguages(agent.voiceLanguages);
    const sttProvider = normalizeSttProvider(agent.sttProvider);
    const latency = getLatencyConfig(sttProvider, { telephony });
    const useRealtimeS2s = isS2sPipeline(agent.voicePipeline);
    const useGeminiLive = isGeminiLivePipeline(agent.voicePipeline);
    const vad = useRealtimeS2s ? undefined : createCallVad(latency.vad);

    const session = useRealtimeS2s
      ? new voice.AgentSession({
          // OpenAI Realtime / Gemini Live own STT + TTS + turn detection.
          turnHandling: {
            turnDetection: 'realtime_llm',
            interruption: {
              minDuration: latency.interruption.minDuration,
              minWords: latency.interruption.minWords,
              resumeFalseInterruption: latency.interruption.resumeFalseInterruption,
              falseInterruptionTimeout: latency.interruption.falseInterruptionTimeout,
            },
          },
          // Phone: shorter AEC warmup so mid-sentence barge works sooner (~3s felt "deaf").
          aecWarmupDuration: telephony ? latency.aecWarmupDuration : undefined,
          ttsReadIdleTimeout: 20_000,
        })
      : new voice.AgentSession({
          stt: createStt(agent, {
            languages: speakLanguages,
            sampleRate: 16000,
            vad,
            onError: (message) => publishCallError(ctx.room, message, 'stt'),
          }),
          vad: vad!,
          turnHandling: {
            turnDetection: 'vad',
            endpointing: latency.endpointing,
            preemptiveGeneration: {
              enabled: latency.preemptiveGeneration.enabled,
              preemptiveTts: latency.preemptiveGeneration.preemptiveTts,
              maxSpeechDuration: latency.preemptiveGeneration.maxSpeechDuration,
              maxRetries: latency.preemptiveGeneration.maxRetries,
            },
            interruption: {
              minDuration: latency.interruption.minDuration,
              minWords: latency.interruption.minWords,
              resumeFalseInterruption: latency.interruption.resumeFalseInterruption,
              falseInterruptionTimeout: latency.interruption.falseInterruptionTimeout,
            },
          },
          aecWarmupDuration: telephony ? latency.aecWarmupDuration : undefined,
          ttsReadIdleTimeout: 20_000,
        });

    const voiceAgent = createVoiceAgent(
      agent,
      callId,
      direction,
      prospectName,
      contactPhone,
      contactEmail,
      ctx.room,
      { telephony },
    );

    await session.start({
      agent: voiceAgent,
      room: ctx.room,
      inputOptions: {
        // Gemini Live expects 16 kHz; OpenAI Realtime uses 24 kHz.
        audioSampleRate: useGeminiLive ? 16000 : useRealtimeS2s ? 24000 : 16000,
        audioNumChannels: 1,
        noiseCancellation: resolveNoiseCancellation({ telephony }),
        deleteRoomOnClose: true,
      },
    });

    console.info(
      'AGENT_SESSION_STARTED',
      JSON.stringify({
        roomName,
        callId: callId ?? null,
        telephony,
      }),
    );

    // Ambient office tone can confuse Gemini Live VAD — only for cascaded / OpenAI.
    const ambient = useGeminiLive
      ? { close: async () => undefined }
      : await startAmbientAudio(ctx.room, session);
    ctx.addShutdownCallback(() => ambient.close());

    attachCallTelemetry(session, ctx.room);
    attachCallTranscriptPersist(session, ctx.room, callId);
    attachSilenceWatchdog(session, agent.skillsConfig);

    if (useRealtimeS2s) {
      const pipeline = isGeminiLivePipeline(agent.voicePipeline) ? 'gemini_live' : 'openai_realtime';
      const s2sConfig =
        agent.realtimeS2sConfig ??
        normalizeRealtimeS2sUserConfig({ voice: agent.realtimeVoice }, pipeline);
      const sessionConfig = realtimeS2sUserConfigToSessionConfig(s2sConfig, 'studio_default', pipeline);
      publishSessionConfig(ctx.room, {
        callId,
        direction,
        agentName: agent.name,
        realtimeS2s: sessionConfig,
        appliedVoice: s2sConfig.voice,
      });
      console.info(
        `[vsa] S2S call started — provider=${s2sConfig.provider} voice=${s2sConfig.voice} model=${s2sConfig.model}${telephony ? ' telephony=1' : ''}`,
      );
    } else {
      console.info(
        `[vsa] Cascaded call started — STT=${agent.sttProvider ?? 'azure'} model=${agent.sttModel || '(default)'}`,
      );
    }

    if (direction === 'outbound') {
      try {
        // Realtime models cannot use allowInterruptions:false; Gemini 3.1 cannot generateReply
        // (remapped to 2.5 on telephony). allowInterruptions must stay true for server VAD.
        await session
          .generateReply({
            instructions: buildOutboundOpenerInstructions(agent, prospectName),
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
    }
  },
});

async function boot() {
  try {
    await probeAzureSpeechKey();
    console.info('[vsa] Azure Speech key OK — STT ready (cascaded pipeline)');
  } catch (err) {
    console.error(
      '[vsa] Azure Speech not ready — cascaded agents will not hear callers until AZURE_SPEECH_KEY is fixed (S2S pipelines do not need Azure):',
      err instanceof Error ? err.message : String(err),
    );
  }
  probeSarvamApiKey();

  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: 'voice-sales-agent-v2',
    }),
  );
}

void boot();
