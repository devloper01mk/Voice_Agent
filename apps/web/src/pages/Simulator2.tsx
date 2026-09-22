import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
  useVoiceAssistant,
} from '@livekit/components-react';
import { ConnectionState, RoomEvent, type AudioCaptureOptions } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isGeminiLivePipeline,
  isS2sPipeline,
  normalizeVoicePipeline,
  realtimeS2sUserConfigToSessionConfig,
  stripSystemNotesForDisplay,
  stripAgentToolNoiseForDisplay,
  type LlmProvider,
  type RealtimeS2sSessionConfig,
  type VoicePipeline,
} from '@vsa/shared';
import SimulatorSetupForm from '../components/SimulatorSetupForm';
import CallSummaryPanel from '../components/CallSummaryPanel';
import EstimatedUsagePanel from '../components/EstimatedUsagePanel';
import S2sEstimatedUsagePanel from '../components/S2sEstimatedUsagePanel';
import LatencyReadout, { formatDuration } from '../components/LatencyReadout';
import LiveTranscriptPanel from '../components/LiveTranscriptPanel';
import RealtimeS2sMetricsPanel from '../components/RealtimeS2sMetricsPanel';
import {
  type AgentSummary,
  type CallMetricsSummary,
  type TranscriptLine,
  getSimulator2Token,
  listAgents,
  saveCallSummary,
} from '../api';

const TELEMETRY_TOPIC = 'vsa.call';

const MIC_CAPTURE_DEFAULTS: AudioCaptureOptions = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  voiceIsolation: true,
};
const FELT_LATENCY_TARGET_MS = 1_000;

type AgentMetric =
  | { type: 'stt_metrics'; durationMs: number; audioDurationMs: number }
  | {
      type: 'llm_metrics';
      ttftMs: number;
      durationMs: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
    }
  | { type: 'tts_metrics'; ttfbMs: number; durationMs: number; charactersCount: number }
  | { type: 'eou_metrics'; transcriptionDelayMs: number; endOfUtteranceDelayMs: number }
  | {
      type: 'realtime_model_metrics';
      ttftMs: number;
      durationMs: number;
      cancelled?: boolean;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      inputTokenDetails?: {
        audioTokens?: number;
        textTokens?: number;
        imageTokens?: number;
        cachedTokens?: number;
      };
      outputTokenDetails?: {
        audioTokens?: number;
        textTokens?: number;
        imageTokens?: number;
      };
    };

function CallSession({
  callId,
  llmProvider,
  llmModel,
  direction,
  agentWorkerHint,
  s2sActive,
  s2sConfig,
  agentName,
  onEnd,
}: {
  callId: string;
  llmProvider: LlmProvider;
  llmModel: string;
  direction: 'inbound' | 'outbound';
  agentWorkerHint: string;
  s2sActive: boolean;
  s2sConfig?: RealtimeS2sSessionConfig | null;
  agentName?: string;
  onEnd: (summary: { transcript: TranscriptLine[]; metrics: CallMetricsSummary }) => void;
}) {
  const room = useRoomContext();
  const state = useConnectionState();
  const connected = state === ConnectionState.Connected;
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const { state: agentState, agent: voiceAgentParticipant } = useVoiceAssistant();

  const [agentWaitTimedOut, setAgentWaitTimedOut] = useState(false);
  const [micError, setMicError] = useState('');
  const [interimUserText, setInterimUserText] = useState('');
  const [liveS2sConfig, setLiveS2sConfig] = useState<RealtimeS2sSessionConfig | null>(
    s2sConfig ?? null,
  );

  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [metrics, setMetrics] = useState<CallMetricsSummary>({
    callDurationSec: 0,
    userTurns: 0,
    agentTurns: 0,
  });
  const [startedAt] = useState(() => Date.now());
  const linesRef = useRef(lines);
  const metricsRef = useRef(metrics);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setTimeout(() => {
      if (!voiceAgentParticipant) setAgentWaitTimedOut(true);
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [connected, voiceAgentParticipant]);

  useEffect(() => {
    if (!connected) return;
    localParticipant
      .setMicrophoneEnabled(true)
      .then(() => setMicError(''))
      .catch(() => setMicError('Microphone blocked — allow mic access in browser settings.'));
    room.startAudio().catch(() => {
      /* Browser may require clicking "Enable speaker audio" below. */
    });
  }, [connected, localParticipant, room]);

  useEffect(() => {
    const onMediaError = (error: Error) => {
      setMicError(error.message || 'Microphone error');
    };
    room.on(RoomEvent.MediaDevicesError, onMediaError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onMediaError);
    };
  }, [room]);

  const micPublished = [...localParticipant.audioTrackPublications.values()].some(
    (pub) => pub.track && !pub.isMuted,
  );

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  const upsertLine = useCallback((line: TranscriptLine) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.id === line.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = line;
        return next;
      }
      return [...prev, line].sort((a, b) => a.timestamp - b.timestamp);
    });
  }, []);

  const applyAgentMetric = useCallback((m: AgentMetric) => {
    setMetrics((prev) => {
      const next = { ...prev };
      if (m.type === 'stt_metrics') {
        next.lastSttMs = m.durationMs;
        next.totalSttAudioDurationMs = (next.totalSttAudioDurationMs ?? 0) + m.audioDurationMs;
      }
      if (m.type === 'llm_metrics') {
        next.lastLlmTtftMs = m.ttftMs;
        next.totalLlmTokens = (next.totalLlmTokens ?? 0) + m.totalTokens;
        next.totalLlmPromptTokens = (next.totalLlmPromptTokens ?? 0) + m.promptTokens;
        next.totalLlmCompletionTokens =
          (next.totalLlmCompletionTokens ?? 0) + m.completionTokens;
      }
      if (m.type === 'tts_metrics') {
        next.lastTtsTtfbMs = m.ttfbMs;
        next.totalTtsCharacters = (next.totalTtsCharacters ?? 0) + m.charactersCount;
      }
      if (m.type === 'eou_metrics') {
        next.lastEouDelayMs = m.endOfUtteranceDelayMs;
        next.lastE2eMs = m.transcriptionDelayMs + m.endOfUtteranceDelayMs;
      }
      if (m.type === 'realtime_model_metrics' && !m.cancelled) {
        if (m.ttftMs >= 0) next.lastLlmTtftMs = m.ttftMs;
        next.totalS2sInputTextTokens =
          (next.totalS2sInputTextTokens ?? 0) + (m.inputTokenDetails?.textTokens ?? 0);
        next.totalS2sInputAudioTokens =
          (next.totalS2sInputAudioTokens ?? 0) + (m.inputTokenDetails?.audioTokens ?? 0);
        next.totalS2sOutputTextTokens =
          (next.totalS2sOutputTextTokens ?? 0) + (m.outputTokenDetails?.textTokens ?? 0);
        next.totalS2sOutputAudioTokens =
          (next.totalS2sOutputAudioTokens ?? 0) + (m.outputTokenDetails?.audioTokens ?? 0);
        next.totalS2sTokens = (next.totalS2sTokens ?? 0) + (m.totalTokens ?? 0);
        next.totalLlmTokens = (next.totalLlmTokens ?? 0) + (m.totalTokens ?? 0);
        next.totalLlmPromptTokens = (next.totalLlmPromptTokens ?? 0) + (m.inputTokens ?? 0);
        next.totalLlmCompletionTokens =
          (next.totalLlmCompletionTokens ?? 0) + (m.outputTokens ?? 0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== TELEMETRY_TOPIC) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          kind: string;
          id?: string;
          itemId?: string | null;
          text?: string;
          isFinal?: boolean;
          at?: number;
          role?: string;
          metrics?: AgentMetric;
          responseLatencyMs?: number;
          feltResponseMs?: number;
          eouDelayMs?: number;
          llmTtftMs?: number;
          ttsTtfbMs?: number;
          transcriptE2eMs?: number;
          realtimeS2s?: RealtimeS2sSessionConfig;
          appliedVoice?: string;
          callId?: string;
          direction?: string;
          agentName?: string;
        };

        if (msg.kind === 'session_config' && msg.realtimeS2s) {
          const applied = msg.appliedVoice?.trim();
          setLiveS2sConfig(
            applied ? { ...msg.realtimeS2s, voice: applied } : msg.realtimeS2s,
          );
        }

        if (msg.kind === 'user_transcript' && msg.text) {
          if (msg.isFinal) {
            setInterimUserText('');
          } else {
            setInterimUserText(msg.text);
          }
        }

        if (msg.kind === 'conversation' && msg.text) {
          const role = msg.role === 'user' ? 'user' : 'agent';
          const text =
            role === 'user'
              ? stripSystemNotesForDisplay(msg.text)
              : stripAgentToolNoiseForDisplay(msg.text);
          if (!text) return;
          upsertLine({
            id: msg.id ?? `conv-${role}-${msg.at ?? Date.now()}`,
            role,
            text,
            isFinal: true,
            timestamp: msg.at ?? Date.now(),
          });
          if (role === 'user') setInterimUserText('');
          setMetrics((prev) => ({
            ...prev,
            userTurns: role === 'user' ? prev.userTurns + 1 : prev.userTurns,
            agentTurns: role === 'agent' ? prev.agentTurns + 1 : prev.agentTurns,
          }));
        }

        if (msg.kind === 'metric' && msg.metrics) {
          applyAgentMetric(msg.metrics);
        }

        if (msg.kind === 'turn_metrics') {
          const feltResponseMs =
            typeof msg.feltResponseMs === 'number' ? msg.feltResponseMs : undefined;
          const responseLatencyMs =
            typeof msg.responseLatencyMs === 'number' ? msg.responseLatencyMs : undefined;
          setMetrics((prev) => {
            const next = { ...prev, lastTurnBundled: true };
            if (feltResponseMs != null) {
              const feltSamples = (prev.feltResponseSamples ?? 0) + 1;
              next.lastFeltResponseMs = feltResponseMs;
              next.feltResponseSamples = feltSamples;
              next.avgFeltResponseMs =
                prev.avgFeltResponseMs != null
                  ? (prev.avgFeltResponseMs * (feltSamples - 1) + feltResponseMs) / feltSamples
                  : feltResponseMs;
            }
            if (responseLatencyMs != null) {
              const samples = (prev.responseLatencySamples ?? 0) + 1;
              next.lastResponseLatencyMs = responseLatencyMs;
              next.responseLatencySamples = samples;
              next.avgResponseLatencyMs =
                prev.avgResponseLatencyMs != null
                  ? (prev.avgResponseLatencyMs * (samples - 1) + responseLatencyMs) / samples
                  : responseLatencyMs;
            }
            if (typeof msg.eouDelayMs === 'number') next.lastEouDelayMs = msg.eouDelayMs;
            if (typeof msg.llmTtftMs === 'number') next.lastLlmTtftMs = msg.llmTtftMs;
            if (typeof msg.ttsTtfbMs === 'number') next.lastTtsTtfbMs = msg.ttsTtfbMs;
            if (typeof msg.transcriptE2eMs === 'number') next.lastE2eMs = msg.transcriptE2eMs;
            return next;
          });
        }

        if (msg.kind === 'response_latency' && typeof msg.responseLatencyMs === 'number') {
          const responseLatencyMs = msg.responseLatencyMs;
          const feltResponseMs =
            typeof msg.feltResponseMs === 'number' ? msg.feltResponseMs : responseLatencyMs;
          setMetrics((prev) => {
            const samples = (prev.responseLatencySamples ?? 0) + 1;
            const feltSamples = (prev.feltResponseSamples ?? 0) + 1;
            const avgResponseLatencyMs =
              prev.avgResponseLatencyMs != null
                ? (prev.avgResponseLatencyMs * (samples - 1) + responseLatencyMs) / samples
                : responseLatencyMs;
            const avgFeltResponseMs =
              prev.avgFeltResponseMs != null
                ? (prev.avgFeltResponseMs * (feltSamples - 1) + feltResponseMs) / feltSamples
                : feltResponseMs;
            return {
              ...prev,
              lastResponseLatencyMs: responseLatencyMs,
              lastFeltResponseMs: feltResponseMs,
              avgResponseLatencyMs,
              avgFeltResponseMs,
              responseLatencySamples: samples,
              feltResponseSamples: feltSamples,
            };
          });
        }
      } catch {
        /* ignore malformed packets */
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, upsertLine, applyAgentMetric]);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        callDurationSec: Math.floor((Date.now() - startedAt) / 1000),
        userTurns: linesRef.current.filter((l) => l.role === 'user').length,
        agentTurns: linesRef.current.filter((l) => l.role === 'agent').length,
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [connected, startedAt]);

  const finish = async () => {
    const summary = {
      transcript: linesRef.current,
      metrics: {
        ...metricsRef.current,
        callDurationSec: Math.floor((Date.now() - startedAt) / 1000),
      },
    };
    try {
      await saveCallSummary(callId, summary);
    } catch {
      /* best-effort persist */
    }
    room.disconnect();
    onEnd(summary);
  };

  const userLive = interimUserText;

  return (
    <div className="simulator-session">
      <div className="phone-screen">
        <div>
          <p className="sim-phone-status">
            <span className={`status-dot ${connected ? 'live' : ''}`} />
            {connected ? 'On call' : 'Connecting…'}
          </p>
          <div className="sim-phone-meta">
            <p className="sim-agent-state">
              Agent:{' '}
              {voiceAgentParticipant
                ? agentState
                : agentWaitTimedOut
                  ? 'not connected'
                  : 'joining…'}
            </p>
            <p className="sim-agent-state">
              LLM:{' '}
              {s2sActive && liveS2sConfig
                ? `OpenAI Realtime · ${liveS2sConfig.model}`
                : formatLlmLabel(llmProvider, llmModel)}
            </p>
            <p className="sim-agent-state">
              Voice:{' '}
              {s2sActive && liveS2sConfig
                ? `${liveS2sConfig.voice} (OpenAI Realtime)`
                : 'Cartesia TTS (Studio voice)'}
            </p>
            <p className="sim-agent-state">
              Mic: {micError || (isMicrophoneEnabled && micPublished ? 'on' : 'starting…')}
            </p>
          </div>
          {agentState === 'speaking' && (
            <p className="sim-hint sim-speaking-hint">
              Agent bol rahi hai — zarurat ho to beech mein bolkar interrupt kar sakte hain.
            </p>
          )}
          {agentWaitTimedOut && !voiceAgentParticipant && (
            <p className="sim-warn">
              Voice agent worker is not running. In a terminal run:{' '}
              <code>{agentWorkerHint}</code>
            </p>
          )}
          {micError && <p className="sim-warn">{micError}</p>}
          <LatencyReadout metrics={metrics} highlightFelt feltTargetMs={FELT_LATENCY_TARGET_MS} />
          {userLive && (
            <p className="sim-user-live">
              You: <span>{userLive}</span>
            </p>
          )}
          <p className="muted sim-hint">
            {direction === 'outbound'
              ? 'Outgoing call — the agent will speak first. Listen for the opener, then respond naturally.'
              : 'Incoming call — you speak first (e.g. ask if this is Cronberry). Speak first in a quiet room if you can.'}
            {' '}
            Headphones are best; on phone/laptop speakers keep volume moderate. Background noise is filtered server-side.
          </p>
        </div>
        <div className="sim-phone-end">
          <button type="button" className="danger" onClick={finish}>
            End call
          </button>
        </div>
      </div>

      <div className="sim-panels">
        <LiveTranscriptPanel
          lines={lines}
          emptyMessage={
            direction === 'outbound'
              ? 'Waiting for the agent opener…'
              : 'Waiting for speech… say hello to start the call.'
          }
        />

        <section className="sim-panel sim-metrics">
          <div className="sim-panel-head">
            <span className="sim-panel-icon" aria-hidden>⚡</span>
            <h2>Low-latency metrics</h2>
          </div>
          <div className="sim-metrics-pills">
            <div className="sim-stat-pill">
              <span className="sim-stat-pill-label">Duration</span>
              <span className="sim-stat-pill-value">{formatDuration(metrics.callDurationSec)}</span>
            </div>
            <div className="sim-stat-pill">
              <span className="sim-stat-pill-label">Your turns</span>
              <span className="sim-stat-pill-value">{metrics.userTurns}</span>
            </div>
            <div className="sim-stat-pill">
              <span className="sim-stat-pill-label">Agent turns</span>
              <span className="sim-stat-pill-value">{metrics.agentTurns}</span>
            </div>
            <div className="sim-stat-pill">
              <span className="sim-stat-pill-label">LLM tokens</span>
              <span className="sim-stat-pill-value">{metrics.totalLlmTokens ?? '—'}</span>
            </div>
          </div>
          <LatencyReadout metrics={metrics} highlightFelt feltTargetMs={FELT_LATENCY_TARGET_MS} />
          {s2sActive ? (
            <S2sEstimatedUsagePanel
              metrics={metrics}
              provider={liveS2sConfig?.provider ?? s2sConfig?.provider}
              model={liveS2sConfig?.model ?? s2sConfig?.model}
            />
          ) : (
            <EstimatedUsagePanel metrics={metrics} llmProvider={llmProvider} />
          )}
        </section>

        {s2sActive && liveS2sConfig && (
          <section className="sim-panel sim-metrics sim-metrics-s2s">
            <div className="sim-panel-head">
              <span className="sim-panel-icon" aria-hidden>🎙️</span>
              <h2>Realtime S2S config</h2>
            </div>
            <RealtimeS2sMetricsPanel
              config={liveS2sConfig}
              callId={callId}
              direction={direction}
              agentName={agentName}
              startedAt={startedAt}
            />
          </section>
        )}
      </div>
    </div>
  );
}

function formatLlmLabel(provider: string, model: string) {
  const name = provider === 'gpt' ? 'GPT' : 'Groq';
  return `${name} · ${model}`;
}

export default function Simulator2Page() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState('');
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [prospectName, setProspectName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [activeDirection, setActiveDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [sessionPipeline, setSessionPipeline] = useState<VoicePipeline | null>(null);
  const [sessionS2sConfig, setSessionS2sConfig] = useState<RealtimeS2sSessionConfig | null>(null);
  const [lastSummary, setLastSummary] = useState<{
    transcript: TranscriptLine[];
    metrics: CallMetricsSummary;
  } | null>(null);

  useEffect(() => {
    listAgents()
      .then((list) => {
        setAgents(list);
        if (list[0]) setAgentId(list[0].id);
      })
      .catch(() => setError('Cannot load agents — start API + database.'));
  }, []);

  const startCall = async () => {
    if (!agentId) {
      setError('Create and save an agent in Studio first.');
      return;
    }
    setStarting(true);
    setError('');
    setLastSummary(null);
    try {
      // Always use Agent Studio voice pipeline / S2S config (no simulator override).
      const creds = await getSimulator2Token(agentId, {
        participantName: `user-${Date.now()}`,
        direction,
        prospectName: prospectName.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
      });
      setToken(creds.token);
      setUrl(creds.url);
      setCallId(creds.callId);
      const pipeline = normalizeVoicePipeline(
        creds.voicePipeline ?? agents.find((a) => a.id === agentId)?.voicePipeline,
      );
      setSessionPipeline(pipeline);
      setSessionS2sConfig(
        creds.realtimeS2sConfig
          ? realtimeS2sUserConfigToSessionConfig(creds.realtimeS2sConfig, 'studio_default', pipeline)
          : null,
      );
      setActiveDirection(direction);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const hint =
        message.includes('LiveKit is not configured') || /\(5\d\d\)/.test(message)
          ? ' Check LiveKit keys and agent worker.'
          : '';
      setError(`Failed to start call: ${message}${hint}`);
    } finally {
      setStarting(false);
    }
  };

  const endSession = () => {
    setToken(null);
    setUrl(null);
    setCallId(null);
    setSessionPipeline(null);
    setSessionS2sConfig(null);
  };

  const onCallEnded = (summary: { transcript: TranscriptLine[]; metrics: CallMetricsSummary }) => {
    setLastSummary(summary);
    endSession();
  };

  const selectedAgent = agents.find((a) => a.id === agentId);
  const effectivePipeline: VoicePipeline =
    sessionPipeline ?? normalizeVoicePipeline(selectedAgent?.voicePipeline);
  const s2sActive = isS2sPipeline(effectivePipeline);
  const studioLlmProvider: LlmProvider =
    selectedAgent?.llmProvider === 'gpt' ? 'gpt' : 'groq';
  const studioLlmModel = selectedAgent?.llmModel ?? '—';

  return (
    <div className="card simulator-page simulator-page-v2">
      <div className="sim-v2-header">
        <h1 className="page-title">
          <span className="page-icon" aria-hidden>
            ⚡
          </span>
          Call Simulator 2.0
        </h1>
        <span className="sim-v2-badge">LOW LATENCY</span>
      </div>
      <p className="page-subtitle">
        Uses the voice pipeline saved on the agent in Studio (Cascaded, OpenAI Realtime, or Gemini
        Live).
      </p>
      {s2sActive && (
        <div className="sim-v2-banner">
          {isGeminiLivePipeline(effectivePipeline) ? 'Gemini Live S2S active' : 'OpenAI Realtime S2S active'}
          {sessionS2sConfig
            ? ` · ${sessionS2sConfig.model} · ${sessionS2sConfig.voice}`
            : selectedAgent?.realtimeVoice
              ? ` · voice ${selectedAgent.realtimeVoice}`
              : ''}
          . Azure STT and Cartesia TTS are skipped for this call.
        </div>
      )}

      {!token && (
        <>
          <SimulatorSetupForm
            agents={agents}
            agentId={agentId}
            onAgentIdChange={setAgentId}
            direction={direction}
            onDirectionChange={setDirection}
            prospectName={prospectName}
            onProspectNameChange={setProspectName}
            contactPhone={contactPhone}
            onContactPhoneChange={setContactPhone}
            contactEmail={contactEmail}
            onContactEmailChange={setContactEmail}
            error={error}
            starting={starting}
            onStartCall={startCall}
            workerCommand="npm run dev:agent-v2"
            llmInfo={
              selectedAgent ? (
                <>
                  ⚡{' '}
                  {s2sActive
                    ? `${isGeminiLivePipeline(effectivePipeline) ? 'Gemini Live' : 'OpenAI Realtime'} S2S`
                    : formatLlmLabel(
                        selectedAgent.llmProvider,
                        selectedAgent.llmModel,
                      )}
                </>
              ) : null
            }
            generalKnowledgeEnabled={selectedAgent?.generalKnowledgeEnabled}
          />

          {lastSummary && (
            <CallSummaryPanel
              metrics={lastSummary.metrics}
              transcript={lastSummary.transcript}
              formatDuration={formatDuration}
              latencyReadout={<LatencyReadout metrics={lastSummary.metrics} highlightFelt feltTargetMs={FELT_LATENCY_TARGET_MS} />}
              usagePanel={
                s2sActive ||
                (lastSummary.metrics.totalS2sTokens ?? 0) > 0 ||
                (lastSummary.metrics.totalS2sInputAudioTokens ?? 0) > 0 ? (
                  <S2sEstimatedUsagePanel
                    metrics={lastSummary.metrics}
                    provider={
                      sessionS2sConfig?.provider ??
                      (isGeminiLivePipeline(effectivePipeline) ? 'gemini' : 'openai')
                    }
                    model={sessionS2sConfig?.model}
                  />
                ) : (
                  <EstimatedUsagePanel metrics={lastSummary.metrics} llmProvider={studioLlmProvider} />
                )
              }
            />
          )}
        </>
      )}

      {token && url && callId && (
        <LiveKitRoom
          token={token}
          serverUrl={url}
          connect
          audio
          video={false}
          onDisconnected={() => endSession()}
          onError={(err) => setError(err.message)}
          options={{
            audioCaptureDefaults: MIC_CAPTURE_DEFAULTS,
            publishDefaults: {
              audioPreset: { maxBitrate: 48000 },
            },
          }}
        >
          <CallSession
            callId={callId}
            llmProvider={studioLlmProvider}
            llmModel={studioLlmModel}
            direction={activeDirection}
            agentWorkerHint="npm run dev:agent-v2"
            s2sActive={s2sActive}
            s2sConfig={sessionS2sConfig}
            agentName={selectedAgent?.name}
            onEnd={onCallEnded}
          />
          <StartAudio label="Enable speaker audio" />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </div>
  );
}
