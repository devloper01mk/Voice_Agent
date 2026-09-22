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
  stripSystemNotesForDisplay,
  stripAgentToolNoiseForDisplay,
  type LlmProvider,
} from '@vsa/shared';
import SimulatorSetupForm from '../components/SimulatorSetupForm';
import CallSummaryPanel from '../components/CallSummaryPanel';
import EstimatedUsagePanel from '../components/EstimatedUsagePanel';
import LatencyReadout, { formatDuration } from '../components/LatencyReadout';
import LiveTranscriptPanel from '../components/LiveTranscriptPanel';
import {
  type AgentSummary,
  type CallMetricsSummary,
  type TranscriptLine,
  getLiveKitToken,
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

async function requestMicPermission(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone is not supported in this browser.');
  }
  return navigator.mediaDevices.getUserMedia({ audio: MIC_CAPTURE_DEFAULTS });
}

function getMicDeviceLabel(stream: MediaStream): string {
  const track = stream.getAudioTracks()[0];
  return track?.label?.trim() || 'Default microphone';
}

function MicLevelBar({ level }: { level: number }) {
  return (
    <div className="mic-level" aria-label="Microphone level">
      <div className="mic-level-track">
        <div className="mic-level-fill" style={{ width: `${Math.min(100, level)}%` }} />
      </div>
      <span className="mic-level-label">{level > 8 ? 'hearing audio' : 'silent'}</span>
    </div>
  );
}

function useAudioLevel(stream: MediaStream | null, active: boolean) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active || !stream) {
      setLevel(0);
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i]!;
      const normalized = Math.min(100, Math.round((sum / data.length / 255) * 100 * 2.5));
      setLevel(normalized);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void audioContext.close();
    };
  }, [active, stream]);

  return level;
}

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
  | { type: 'eou_metrics'; transcriptionDelayMs: number; endOfUtteranceDelayMs: number };


function CallSession({
  callId,
  llmProvider,
  llmModel,
  direction,
  onEnd,
}: {
  callId: string;
  llmProvider: LlmProvider;
  llmModel: string;
  direction: 'inbound' | 'outbound';
  onEnd: (summary: { transcript: TranscriptLine[]; metrics: CallMetricsSummary }) => void;
}) {
  const room = useRoomContext();
  const state = useConnectionState();
  const connected = state === ConnectionState.Connected;
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const { state: agentState, agent: voiceAgentParticipant } = useVoiceAssistant();

  const [agentWaitTimedOut, setAgentWaitTimedOut] = useState(false);
  const [micError, setMicError] = useState('');
  const [micDeviceName, setMicDeviceName] = useState('');
  const [audioSilenceWarning, setAudioSilenceWarning] = useState(false);
  const [micNoAudioWarning, setMicNoAudioWarning] = useState(false);
  const [pipelineError, setPipelineError] = useState('');
  const [interimUserText, setInterimUserText] = useState('');
  const [micMonitorStream, setMicMonitorStream] = useState<MediaStream | null>(null);
  const callStartedAtRef = useRef(Date.now());
  const lastMicActivityAtRef = useRef(Date.now());

  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [metrics, setMetrics] = useState<CallMetricsSummary>({
    callDurationSec: 0,
    userTurns: 0,
    agentTurns: 0,
  });
  const [startedAt] = useState(() => Date.now());
  const linesRef = useRef(lines);
  const metricsRef = useRef(metrics);

  const micPublished = [...localParticipant.audioTrackPublications.values()].some(
    (pub) => pub.track && !pub.isMuted,
  );

  useEffect(() => {
    if (!connected) return;
    const timer = window.setTimeout(() => {
      if (!voiceAgentParticipant) setAgentWaitTimedOut(true);
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [connected, voiceAgentParticipant]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    const enableMic = async (attempt = 0) => {
      try {
        await localParticipant.setMicrophoneEnabled(true);
        const pub = [...localParticipant.audioTrackPublications.values()].find(
          (p) => p.track && !p.isMuted,
        );
        const label = pub?.track?.mediaStreamTrack?.label?.trim();
        if (label) setMicDeviceName(label);
        setMicError('');
      } catch {
        if (attempt < 2) {
          window.setTimeout(() => void enableMic(attempt + 1), 1500);
          return;
        }
        setMicError('Microphone blocked — allow mic access in browser settings.');
      }
    };

    void enableMic();
    room.startAudio().catch(() => {
      /* Browser may require clicking "Enable speaker audio" below. */
    });

    return () => {
      cancelled = true;
    };
  }, [connected, localParticipant, room]);

  useEffect(() => {
    if (!connected || micPublished) return;
    const timer = window.setTimeout(() => {
      void localParticipant
        .setMicrophoneEnabled(true)
        .then(() => setMicError(''))
        .catch(() =>
          setMicError('Microphone failed to publish — check browser permissions and input device.'),
        );
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [connected, micPublished, localParticipant]);

  useEffect(() => {
    const onMediaError = (error: Error) => {
      setMicError(error.message || 'Microphone error');
    };
    const onAudioSilence = () => {
      setAudioSilenceWarning(true);
    };
    room.on(RoomEvent.MediaDevicesError, onMediaError);
    room.on(RoomEvent.LocalAudioSilenceDetected, onAudioSilence);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onMediaError);
      room.off(RoomEvent.LocalAudioSilenceDetected, onAudioSilence);
    };
  }, [room]);

  const micLevel = useAudioLevel(micMonitorStream, connected && micPublished && !micError);

  useEffect(() => {
    if (!connected || !micPublished) {
      setMicMonitorStream(null);
      return;
    }
    const pub = [...localParticipant.audioTrackPublications.values()].find(
      (p) => p.track && !p.isMuted,
    );
    const mediaStreamTrack = pub?.track?.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    const label = mediaStreamTrack.label?.trim();
    if (label) setMicDeviceName(label);
    setMicMonitorStream(new MediaStream([mediaStreamTrack]));
    return () => setMicMonitorStream(null);
  }, [connected, micPublished, localParticipant]);

  useEffect(() => {
    if (micLevel > 8) {
      lastMicActivityAtRef.current = Date.now();
      setAudioSilenceWarning(false);
      setMicNoAudioWarning(false);
    }
  }, [micLevel]);

  useEffect(() => {
    if (!connected || !micPublished || micError) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - callStartedAtRef.current;
      const sinceActivity = Date.now() - lastMicActivityAtRef.current;
      if (
        elapsed > 5000 &&
        sinceActivity > 5000 &&
        voiceAgentParticipant &&
        agentState === 'listening' &&
        !interimUserText
      ) {
        setMicNoAudioWarning(true);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    connected,
    micPublished,
    micError,
    voiceAgentParticipant,
    agentState,
    interimUserText,
  ]);

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
          message?: string;
          source?: string;
        };

        if (msg.kind === 'error' && msg.message) {
          const prefix = msg.source ? `${msg.source}: ` : '';
          setPipelineError(`${prefix}${msg.message}`);
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
            <p className="sim-agent-state">LLM: {formatLlmLabel(llmProvider, llmModel)}</p>
            <p className="sim-agent-state">
              Mic:{' '}
              {micError
                ? 'blocked'
                : isMicrophoneEnabled && micPublished
                  ? `on${micDeviceName ? ` · ${micDeviceName}` : ''}`
                  : 'starting…'}
            </p>
          </div>
          {agentState === 'thinking' && (
            <p className="sim-hint sim-speaking-hint">
              Agent is thinking — wait a moment for the reply.
            </p>
          )}
          {agentState === 'speaking' && (
            <p className="sim-hint sim-speaking-hint">
              Agent bol rahi hai — thoda rukiye, phir boliye.
            </p>
          )}
          {micPublished && !micError && <MicLevelBar level={micLevel} />}
          {agentWaitTimedOut && !voiceAgentParticipant && (
            <p className="sim-warn">
              Voice agent worker is not running. In a terminal run:{' '}
              <code>npm run dev:agent</code>
            </p>
          )}
          {micError && <p className="sim-warn">{micError}</p>}
          {audioSilenceWarning && !micError && (
            <p className="sim-warn">
              Mic is on but no audio detected — check your input device in browser settings.
            </p>
          )}
          {micNoAudioWarning && !micError && !audioSilenceWarning && (
            <p className="sim-warn">
              No speech detected yet — speak clearly into the mic, then pause about 1 second.
            </p>
          )}
          {pipelineError && <p className="sim-warn">Agent pipeline error: {pipelineError}</p>}
          <LatencyReadout metrics={metrics} />
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
            <span className="sim-panel-icon" aria-hidden>📊</span>
            <h2>Metrics & usage</h2>
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
              <span className="sim-stat-pill-label">STT (last)</span>
              <span className="sim-stat-pill-value">
                {metrics.lastSttMs != null ? `${Math.round(metrics.lastSttMs)} ms` : '—'}
              </span>
            </div>
          </div>
          <LatencyReadout metrics={metrics} />
          <EstimatedUsagePanel metrics={metrics} llmProvider={llmProvider} />
        </section>
      </div>
    </div>
  );
}

function formatLlmLabel(provider: string, model: string) {
  const name = provider === 'gpt' ? 'GPT' : 'Groq';
  return `${name} · ${model}`;
}

export default function SimulatorPage() {
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
  const [micTestStream, setMicTestStream] = useState<MediaStream | null>(null);
  const [micTesting, setMicTesting] = useState(false);
  const [micTestError, setMicTestError] = useState('');
  const [micTestDevice, setMicTestDevice] = useState('');
  const micTestLevel = useAudioLevel(micTestStream, micTesting);
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
      const stream = await requestMicPermission();
      setMicTestDevice(getMicDeviceLabel(stream));
      stream.getTracks().forEach((track) => track.stop());
      setMicTestStream(null);
      setMicTesting(false);

      const creds = await getLiveKitToken(agentId, {
        participantName: `user-${Date.now()}`,
        direction,
        prospectName: prospectName.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
      });
      setToken(creds.token);
      setUrl(creds.url);
      setCallId(creds.callId);
      setActiveDirection(direction);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (
        message.includes('Permission') ||
        message.includes('NotAllowed') ||
        message.includes('Microphone')
      ) {
        setError(`Microphone access required: ${message}`);
      } else {
        setError(
          message.includes('LiveKit') || message.includes('token')
            ? `Failed to start call: ${message}. Check LiveKit keys and agent worker.`
            : `Failed to start call: ${message}`,
        );
      }
    } finally {
      setStarting(false);
    }
  };

  const testMic = async () => {
    setMicTestError('');
    setMicTesting(true);
    try {
      const stream = await requestMicPermission();
      setMicTestDevice(getMicDeviceLabel(stream));
      setMicTestStream(stream);
      window.setTimeout(() => {
        stream.getTracks().forEach((track) => track.stop());
        setMicTestStream(null);
        setMicTesting(false);
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Microphone test failed';
      setMicTestError(message);
      setMicTesting(false);
    }
  };

  useEffect(() => {
    return () => {
      micTestStream?.getTracks().forEach((track) => track.stop());
    };
  }, [micTestStream]);

  const endSession = () => {
    setToken(null);
    setUrl(null);
    setCallId(null);
  };

  const onCallEnded = (summary: { transcript: TranscriptLine[]; metrics: CallMetricsSummary }) => {
    setLastSummary(summary);
    endSession();
  };

  const selectedAgent = agents.find((a) => a.id === agentId);
  const selectedLlmProvider: LlmProvider =
    selectedAgent?.llmProvider === 'gpt' ? 'gpt' : 'groq';
  const selectedLlmModel = selectedAgent?.llmModel ?? '—';

  return (
    <div className="card simulator-page">
      <h1 className="page-title">
        <span className="page-icon" aria-hidden>📞</span>
        Call Simulator
      </h1>
      <p className="page-subtitle">
        Phone-style voice call with live transcript, latency metrics, and usage estimates.
      </p>

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
            workerCommand="npm run dev:agent"
            llmInfo={
              selectedAgent ? (
                <>✨ LLM: {formatLlmLabel(selectedAgent.llmProvider, selectedAgent.llmModel)}</>
              ) : null
            }
            generalKnowledgeEnabled={selectedAgent?.generalKnowledgeEnabled}
            showMicTest
            micTesting={micTesting}
            micTestDevice={micTestDevice}
            micTestLevelBar={micTesting ? <MicLevelBar level={micTestLevel} /> : null}
            micTestError={micTestError}
            onTestMic={testMic}
          />

          {lastSummary && (
            <CallSummaryPanel
              metrics={lastSummary.metrics}
              transcript={lastSummary.transcript}
              formatDuration={formatDuration}
              latencyReadout={<LatencyReadout metrics={lastSummary.metrics} />}
              usagePanel={
                <EstimatedUsagePanel
                  metrics={lastSummary.metrics}
                  llmProvider={selectedLlmProvider}
                />
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
            llmProvider={selectedLlmProvider}
            llmModel={selectedLlmModel}
            direction={activeDirection}
            onEnd={onCallEnded}
          />
          <StartAudio label="Enable speaker audio" />
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </div>
  );
}
