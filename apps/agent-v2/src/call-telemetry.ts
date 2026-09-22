import { voice } from '@livekit/agents';
import type { Room } from '@livekit/rtc-node';
import type { RealtimeS2sSessionConfig } from '@vsa/shared';
import { stripSystemNotesForDisplay, stripAgentToolNoiseForDisplay } from '@vsa/shared';

export const CALL_TELEMETRY_TOPIC = 'vsa.call';

function publish(room: Room, payload: object) {
  if (!room.isConnected || !room.localParticipant) return;
  const data = Buffer.from(JSON.stringify(payload));
  room.localParticipant.publishData(data, { reliable: true, topic: CALL_TELEMETRY_TOPIC }).catch(() => {});
}

/** Publish active pipeline config when a Simulator call starts. */
export function publishSessionConfig(
  room: Room,
  payload: {
    callId?: string;
    direction?: string;
    agentName?: string;
    appliedVoice?: string;
    realtimeS2s?: RealtimeS2sSessionConfig;
  },
) {
  publish(room, {
    kind: 'session_config',
    at: Date.now(),
    ...payload,
  });
}

/** Surface pipeline errors to the Simulator UI via the vsa.call data channel. */
export function publishCallError(room: Room, message: string, source?: string) {
  publish(room, { kind: 'error', at: Date.now(), message, source });
}

function messageText(content: Array<string | { value?: string }>): string {
  return content
    .map((c) => (typeof c === 'string' ? c : (c.value ?? '')))
    .join('')
    .trim();
}

interface TurnMetricBucket {
  speechId?: string;
  eouDelayMs?: number;
  transcriptE2eMs?: number;
  llmTtftMs?: number;
  ttsTtfbMs?: number;
}

export function attachCallTelemetry(session: voice.AgentSession, room: Room) {
  let pendingTurnCommitAt: number | null = null;
  let speechEndAt: number | null = null;
  let activeTurn: TurnMetricBucket = {};

  const resetActiveTurn = () => {
    activeTurn = {};
  };

  session.on(voice.AgentSessionEventTypes.Error, (ev) => {
    const err = ev.error as { message?: string };
    const message = err?.message ?? String(ev.error);
    const sourceLabel =
      ev.source && typeof ev.source === 'object' && 'label' in ev.source
        ? String((ev.source as { label?: string }).label ?? 'agent')
        : 'agent';
    publishCallError(room, message, sourceLabel);
  });

  session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
    const metrics = ev.metrics;
    publish(room, { kind: 'metric', at: ev.createdAt, metrics });

    if (metrics.type === 'eou_metrics') {
      pendingTurnCommitAt = ev.createdAt;
      speechEndAt = Math.max(0, ev.createdAt - metrics.endOfUtteranceDelayMs);
      activeTurn = {
        speechId: metrics.speechId,
        eouDelayMs: metrics.endOfUtteranceDelayMs,
        transcriptE2eMs: metrics.transcriptionDelayMs + metrics.endOfUtteranceDelayMs,
      };
    }

    if (metrics.type === 'llm_metrics' && !metrics.cancelled && activeTurn.speechId) {
      if (metrics.speechId === activeTurn.speechId) {
        activeTurn.llmTtftMs = metrics.ttftMs;
      }
    }

    if (metrics.type === 'tts_metrics' && pendingTurnCommitAt != null) {
      const responseLatencyMs = Math.max(0, ev.createdAt - pendingTurnCommitAt);
      const feltResponseMs =
        speechEndAt != null ? Math.max(0, ev.createdAt - speechEndAt) : responseLatencyMs;
      if (metrics.speechId) activeTurn.speechId = metrics.speechId;
      activeTurn.ttsTtfbMs = metrics.ttfbMs;

      publish(room, {
        kind: 'response_latency',
        at: ev.createdAt,
        responseLatencyMs,
        feltResponseMs,
      });
      publish(room, {
        kind: 'turn_metrics',
        at: ev.createdAt,
        speechId: activeTurn.speechId,
        feltResponseMs,
        responseLatencyMs,
        eouDelayMs: activeTurn.eouDelayMs,
        llmTtftMs: activeTurn.llmTtftMs,
        ttsTtfbMs: activeTurn.ttsTtfbMs,
        transcriptE2eMs: activeTurn.transcriptE2eMs,
      });

      pendingTurnCommitAt = null;
      speechEndAt = null;
      resetActiveTurn();
    }

    if (metrics.type === 'realtime_model_metrics' && !metrics.cancelled) {
      if (metrics.ttftMs >= 0) activeTurn.llmTtftMs = metrics.ttftMs;
      const responseLatencyMs =
        pendingTurnCommitAt != null
          ? Math.max(0, ev.createdAt - pendingTurnCommitAt)
          : metrics.durationMs;
      const feltResponseMs =
        speechEndAt != null
          ? Math.max(0, ev.createdAt - speechEndAt)
          : metrics.ttftMs >= 0
            ? metrics.ttftMs
            : responseLatencyMs;
      publish(room, {
        kind: 'response_latency',
        at: ev.createdAt,
        responseLatencyMs,
        feltResponseMs,
      });
      publish(room, {
        kind: 'turn_metrics',
        at: ev.createdAt,
        feltResponseMs,
        responseLatencyMs,
        llmTtftMs: activeTurn.llmTtftMs ?? (metrics.ttftMs >= 0 ? metrics.ttftMs : undefined),
        eouDelayMs: activeTurn.eouDelayMs,
        transcriptE2eMs: activeTurn.transcriptE2eMs,
      });
      pendingTurnCommitAt = null;
      speechEndAt = null;
      resetActiveTurn();
    }
  });

  session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
    publish(room, {
      kind: 'user_transcript',
      at: ev.createdAt,
      itemId: ev.itemId,
      text: ev.transcript,
      isFinal: ev.isFinal,
      language: ev.language,
      sttConfidence: (ev as { transcriptConfidence?: number }).transcriptConfidence,
    });
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
    if (ev.item.type !== 'message') return;
    const msg = ev.item;
    const raw = messageText(msg.content as Array<string | { value?: string }>);
    const text =
      msg.role === 'user'
        ? stripSystemNotesForDisplay(raw)
        : stripAgentToolNoiseForDisplay(raw);
    if (!text) return;

    publish(room, {
      kind: 'conversation',
      id: msg.id,
      at: msg.createdAt,
      role: msg.role,
      text,
      interrupted: msg.interrupted,
      metrics: msg.metrics,
    });
  });
}
