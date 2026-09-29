import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  isS2sPipeline,
  normalizeVoicePipeline,
  type VoicePipeline,
} from '@vsa/shared';
import {
  type AgentSummary,
  type CallMetricsSummary,
  type TranscriptLine,
  getCall,
  getTelephonyTransports,
  hangupOutboundCall,
  initiateOutboundCall,
  listAgents,
} from '../api';
import CallSummaryPanel from '../components/CallSummaryPanel';
import S2sEstimatedUsagePanel from '../components/S2sEstimatedUsagePanel';
import LatencyReadout, { formatDuration } from '../components/LatencyReadout';
import LiveTranscriptPanel from '../components/LiveTranscriptPanel';
import TelephonyLogPanel from '../components/TelephonyLogPanel';
import { useTelephonyEvents } from '../hooks/useTelephonyEvents';

const STATUS_LABEL: Record<string, string> = {
  initiating: 'Dialing…',
  ringing: 'Ringing…',
  'in-progress': 'On call',
  completed: 'Completed',
  failed: 'Failed',
  dial_timeout: 'Dial timeout',
  'no-answer': 'No answer',
  busy: 'Busy',
};

const LIVE_STATUSES = new Set(['initiating', 'ringing', 'in-progress']);

function transcriptFromCall(raw: unknown): TranscriptLine[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((l): l is TranscriptLine => typeof l === 'object' && l && 'text' in l);
  }
  if (typeof raw === 'object' && raw && 'lines' in raw) {
    const lines = (raw as { lines?: TranscriptLine[] }).lines;
    return Array.isArray(lines) ? lines : [];
  }
  return [];
}

function metricsFromCall(raw: unknown): CallMetricsSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const metrics = (raw as { metrics?: CallMetricsSummary }).metrics;
  return metrics ?? null;
}

export default function OutboundCallPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAgentId = searchParams.get('agentId')?.trim() || '';
  const queryTo = searchParams.get('to')?.trim() || '';
  const queryName = searchParams.get('name')?.trim() || '';
  const queryEmail = searchParams.get('email')?.trim() || '';
  const shouldAutodial = searchParams.get('autodial') === '1';

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentId, setAgentId] = useState(queryAgentId);
  const [toNumber, setToNumber] = useState(queryTo);
  const [prospectName, setProspectName] = useState(queryName);
  const [contactEmail, setContactEmail] = useState(queryEmail);
  const [transport, setTransport] = useState<'acefone' | 'livekit_sip'>('acefone');
  const [livekitSipAvailable, setLivekitSipAvailable] = useState(false);
  const [acefoneAvailable, setAcefoneAvailable] = useState(true);
  const [acefoneConfigured, setAcefoneConfigured] = useState(true);
  const [transportReason, setTransportReason] = useState('');
  const [livekitRequiresAgentV2, setLivekitRequiresAgentV2] = useState(true);
  const [transportsReady, setTransportsReady] = useState(false);
  const [waitUntilAnswered, setWaitUntilAnswered] = useState(false);
  const [useDefaultTrunkCallerId, setUseDefaultTrunkCallerId] = useState(false);
  const [playDialtone, setPlayDialtone] = useState(false);
  const autodialFired = useRef(false);
  const [lastTransportEcho, setLastTransportEcho] = useState<{
    selected: string;
    returned?: string;
    provider?: string;
    selectedPath?: string;
    debugMessage?: string;
    roomName?: string;
  } | null>(null);
  const [sessionPipeline, setSessionPipeline] = useState<VoicePipeline | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [hangingUp, setHangingUp] = useState(false);
  const [formError, setFormError] = useState('');
  const [callId, setCallId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [lastSummary, setLastSummary] = useState<{
    transcript: TranscriptLine[];
    metrics: CallMetricsSummary;
  } | null>(null);

  const live = useTelephonyEvents(callId);
  const selectedAgent = agents.find((a) => a.id === agentId);
  const llmModel = selectedAgent?.llmModel?.trim() || '—';
  const studioPipeline = normalizeVoicePipeline(selectedAgent?.voicePipeline);
  const effectivePipeline = sessionPipeline ?? studioPipeline;
  const s2sActive = isS2sPipeline(effectivePipeline);
  const pipelineLabel = 'Gemini Live S2S (Agent Studio)';

  const status = live.status;
  const liveCall = Boolean(callId && status && LIVE_STATUSES.has(status));
  const ended = Boolean(status && !LIVE_STATUSES.has(status));

  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then((list) => {
        if (cancelled) return;
        const agents = Array.isArray(list) ? list : [];
        setAgents(agents);
        const fromQuery = queryAgentId && agents.some((a) => a.id === queryAgentId) ? queryAgentId : '';
        const preferred = fromQuery || agents[0]?.id || '';
        if (preferred) setAgentId(preferred);
        if (!agents.length) setFormError('No agents yet — save one in Agent Studio first.');
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load agents';
        setFormError(message);
      })
      .finally(() => {
        if (!cancelled) setLoadingAgents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queryAgentId]);

  const isStayAgent = selectedAgent?.bookingOutcome === 'stay';

  useEffect(() => {
    let cancelled = false;
    void getTelephonyTransports()
      .then((t) => {
        if (cancelled) return;
        setLivekitSipAvailable(t.livekit_sip);
        setAcefoneAvailable(t.acefone);
        setAcefoneConfigured(Boolean(t.acefoneConfigured ?? t.acefone));
        setTransportReason(t.reason ?? t.acefoneDetail?.reason ?? '');
        setLivekitRequiresAgentV2(t.livekitSipDetail?.requiresAgentV2 !== false);
        setTransport(
          (t.defaultTransport ?? t.recommended) === 'livekit_sip' ? 'livekit_sip' : 'acefone',
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setTransportsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!callId || ended) return;
    const poll = async () => {
      try {
        const call = await getCall(callId);
        if (call.status) {
          const terminal = ['completed', 'failed', 'no-answer', 'busy', 'dial_timeout'].includes(
            call.status,
          );
          if (terminal || !live.connected) live.setStatus(call.status);
        }
      } catch {
        /* ignore transient poll errors */
      }
    };
    void poll();
    const id = window.setInterval(poll, 1000);
    return () => window.clearInterval(id);
  }, [callId, ended, live.connected, live.setStatus]);

  useEffect(() => {
    if (!liveCall || !startedAt) return;
    const id = window.setInterval(() => {
      setDurationSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [liveCall, startedAt]);

  useEffect(() => {
    if (!callId || !ended) return;
    let cancelled = false;
    void (async () => {
      try {
        const call = await getCall(callId);
        if (cancelled) return;
        const transcript = live.lines.length ? live.lines : transcriptFromCall(call.transcript);
        const savedMetrics = metricsFromCall(call.transcript);
        setLastSummary({
          transcript,
          metrics: {
            ...(savedMetrics ?? live.metrics),
            callDurationSec: durationSec || savedMetrics?.callDurationSec || live.metrics.callDurationSec,
            userTurns: savedMetrics?.userTurns ?? live.metrics.userTurns,
            agentTurns: savedMetrics?.agentTurns ?? live.metrics.agentTurns,
          },
        });
      } catch {
        if (!cancelled && live.lines.length) {
          setLastSummary({
            transcript: live.lines,
            metrics: {
              ...live.metrics,
              callDurationSec: durationSec,
            },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, ended, durationSec, live.lines, live.metrics]);

  const displayMetrics = useMemo<CallMetricsSummary>(() => {
    const base = lastSummary?.metrics ?? live.metrics;
    return {
      ...base,
      callDurationSec: liveCall ? durationSec : base.callDurationSec || durationSec,
    };
  }, [lastSummary, live.metrics, liveCall, durationSec]);

  const placeCall = useCallback(async () => {
    setFormError('');
    setLastSummary(null);
    if (!agentId) {
      setFormError('Select an agent');
      return;
    }
    if (!toNumber.trim()) {
      setFormError('Enter a phone number to dial');
      return;
    }

    setPlacing(true);
    try {
      if (transport === 'acefone' && !acefoneAvailable) {
        setFormError('Acefone is not configured. Set ACEFONE_CLICK_TO_CALL_API_KEY (or SMARTFLO_…).');
        setPlacing(false);
        return;
      }
      if (transport === 'livekit_sip' && !livekitSipAvailable) {
        setFormError(
          'LiveKit SIP is not configured. Use Acefone for real phone calls, or set LIVEKIT_SIP_OUTBOUND_TRUNK.',
        );
        setPlacing(false);
        return;
      }
      const result = await initiateOutboundCall({
        agentId,
        toNumber: toNumber.trim(),
        prospectName: prospectName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        voicePipeline: 'agent',
        transport,
        waitUntilAnswered: transport === 'livekit_sip' ? waitUntilAnswered : undefined,
        useDefaultTrunkCallerId:
          transport === 'livekit_sip' ? useDefaultTrunkCallerId : undefined,
        playDialtone: transport === 'livekit_sip' ? playDialtone : undefined,
      });
      setLastTransportEcho({
        selected: transport,
        returned: result.transport,
        provider: result.provider,
        selectedPath: result.selectedPath,
        debugMessage: result.debugMessage,
        roomName: result.roomName,
      });
      setCallId(result.callId);
      setSessionPipeline(studioPipeline);
      live.setStatus(result.status);
      setStartedAt(Date.now());
      setDurationSec(0);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to place call');
    } finally {
      setPlacing(false);
    }
  }, [
    agentId,
    toNumber,
    prospectName,
    contactEmail,
    studioPipeline,
    transport,
    waitUntilAnswered,
    useDefaultTrunkCallerId,
    playDialtone,
    live,
    livekitSipAvailable,
    acefoneAvailable,
  ]);

  useEffect(() => {
    if (!shouldAutodial || autodialFired.current) return;
    if (loadingAgents || !transportsReady || placing || callId) return;
    if (!agentId || !toNumber.trim()) return;

    autodialFired.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('autodial');
    setSearchParams(next, { replace: true });
    void placeCall();
  }, [
    shouldAutodial,
    loadingAgents,
    transportsReady,
    placing,
    callId,
    agentId,
    toNumber,
    placeCall,
    searchParams,
    setSearchParams,
  ]);

  const resetForAnother = () => {
    setCallId(null);
    setSessionPipeline(null);
    setStartedAt(null);
    setDurationSec(0);
    setLastSummary(null);
    setLastTransportEcho(null);
    setFormError('');
  };

  const hangup = async () => {
    if (!callId) return;
    setHangingUp(true);
    try {
      await hangupOutboundCall(callId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to hang up');
    } finally {
      setHangingUp(false);
    }
  };

  const showLivePanels = Boolean(callId);
  const combinedError = formError || live.error;

  return (
    <div className="sim-page">
      <header className="sim-header">
        <h1>Outbound Call</h1>
        <p className="sim-header-sub">
          Real phone outbound supports <strong>Acefone / Smartflo</strong> (default when configured)
          and optional <strong>LiveKit SIP</strong> (agent-v2). Always confirm the selected transport
          below before placing a call.
        </p>
      </header>

      {callId && status ? (
        <div className="phone-screen outbound-live-header">
          <p className="sim-phone-status">
            <span className={`status-dot ${liveCall ? 'live' : ''}`} />
            {STATUS_LABEL[status] ?? status}
          </p>
          <div className="sim-phone-meta">
            <p className="sim-agent-state">
              Agent: {live.agentState ?? (status === 'ringing' ? 'waiting for answer' : '—')}
            </p>
            <p className="sim-agent-state">Pipeline: {pipelineLabel}</p>
            {lastTransportEcho ? (
              <>
                <p className="sim-agent-state">
                  Transport selected: <strong>{lastTransportEcho.selected}</strong>
                </p>
                <p className="sim-agent-state">
                  Transport returned: <strong>{lastTransportEcho.returned ?? '—'}</strong>
                </p>
                <p className="sim-agent-state">
                  Provider: <strong>{lastTransportEcho.provider ?? '—'}</strong>
                  {lastTransportEcho.selectedPath
                    ? ` · path ${lastTransportEcho.selectedPath}`
                    : ''}
                </p>
                {lastTransportEcho.debugMessage ? (
                  <p className="sim-agent-state">{lastTransportEcho.debugMessage}</p>
                ) : null}
              </>
            ) : null}
            <p className="sim-agent-state">
              {s2sActive
                ? 'LLM: Gemini Live (speech-to-speech)'
                : `LLM: GPT · ${llmModel}`}
            </p>
            <p className="sim-agent-state">Duration: {formatDuration(durationSec)}</p>
            <p className="sim-agent-state">
              Events: {live.connected ? 'live' : 'polling fallback'}
            </p>
          </div>
          {live.agentState === 'thinking' && (
            <p className="sim-hint sim-speaking-hint">Agent is thinking — wait a moment for the reply.</p>
          )}
          {live.agentState === 'speaking' && (
            <p className="sim-hint sim-speaking-hint">Agent is speaking on the phone.</p>
          )}
          {liveCall ? (
            <div className="sim-phone-end">
              <button type="button" className="danger" disabled={hangingUp} onClick={() => void hangup()}>
                {hangingUp ? 'Hanging up…' : 'End call'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="sim-setup" style={{ maxWidth: 520 }}>
        <div className="studio-field">
          <label htmlFor="outAgent">Agent</label>
          <select
            id="outAgent"
            value={agentId}
            disabled={loadingAgents || placing || liveCall}
            onChange={(e) => setAgentId(e.target.value)}
          >
            {loadingAgents && <option value="">Loading agents…</option>}
            {!loadingAgents && agents.length === 0 && <option value="">No agents</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.productName ? `· ${a.productName}` : ''}
              </option>
            ))}
          </select>
          {selectedAgent && (
            <p className="studio-field-hint">
              Voice pipeline from Agent Studio: <strong>{pipelineLabel}</strong>. Change under Studio
              → Voice.
            </p>
          )}
        </div>

        <div className="studio-field">
          <label htmlFor="outTransport">Phone transport</label>
          <select
            id="outTransport"
            value={transport}
            disabled={placing || liveCall}
            onChange={(e) => setTransport(e.target.value as 'acefone' | 'livekit_sip')}
          >
            <option value="acefone" disabled={!acefoneAvailable}>
              Acefone / Smartflo (real phone)
              {!acefoneAvailable && !acefoneConfigured
                ? ' — configure Click-to-Call key'
                : !acefoneAvailable
                  ? ' — unavailable'
                  : ''}
            </option>
            <option value="livekit_sip" disabled={!livekitSipAvailable}>
              LiveKit SIP → agent-v2 (optional)
              {!livekitSipAvailable ? ' — configure LIVEKIT_SIP_OUTBOUND_TRUNK' : ''}
            </option>
          </select>
          <p className="sim-hint" style={{ marginTop: '0.35rem', fontSize: '0.8rem', opacity: 0.8 }}>
            {transport === 'acefone'
              ? 'Acefone Voice Bot path for production phone dials.'
              : 'Optional LiveKit SIP path (same worker as Simulator 2.0).'}
          </p>
          <p
            className="studio-field-hint"
            style={{
              marginTop: '0.5rem',
              padding: '0.65rem 0.75rem',
              border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 6,
              background: 'rgba(0,0,0,0.03)',
              fontWeight: 600,
            }}
          >
            {transport === 'acefone'
              ? 'This call will use Acefone / Tata Smartflo Click-to-Call Support. LiveKit SIP trunk will NOT be used.'
              : 'This call will use LiveKit SIP outbound trunk and createSipParticipant.'}
          </p>
          {transport === 'livekit_sip' && livekitRequiresAgentV2 ? (
            <p className="sim-error" style={{ marginTop: '0.5rem' }}>
              Make sure <code>npm run dev:agent-v2</code> is running and registered as{' '}
              <code>voice-sales-agent-v2</code>.
            </p>
          ) : null}
          {transport === 'livekit_sip' ? (
            <>
              <label
                className="studio-field-hint"
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.65rem' }}
              >
                <input
                  type="checkbox"
                  checked={waitUntilAnswered}
                  disabled={placing || liveCall}
                  onChange={(e) => setWaitUntilAnswered(e.target.checked)}
                />
                <span>
                  Debug: wait until call is answered (<code>waitUntilAnswered</code>). Uses 90s API
                  timeout; default off returns quickly and polls <code>sip.callStatus</code> in the
                  background.
                </span>
              </label>
              <label
                className="studio-field-hint"
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.5rem' }}
              >
                <input
                  type="checkbox"
                  checked={useDefaultTrunkCallerId}
                  disabled={placing || liveCall}
                  onChange={(e) => setUseDefaultTrunkCallerId(e.target.checked)}
                />
                <span>
                  Debug: use default trunk caller ID (omit <code>fromNumber</code> — LiveKit trunk CLI).
                </span>
              </label>
              <label
                className="studio-field-hint"
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '0.5rem' }}
              >
                <input
                  type="checkbox"
                  checked={playDialtone}
                  disabled={placing || liveCall}
                  onChange={(e) => setPlayDialtone(e.target.checked)}
                />
                <span>
                  Debug: play dialtone (default off — avoids early-media audio before answer).
                </span>
              </label>
            </>
          ) : null}
          {transportReason ? (
            <p className="studio-field-hint" style={{ marginTop: '0.25rem' }}>
              {transportReason}
            </p>
          ) : null}
          {isStayAgent && transport === 'acefone' ? (
            <p className="studio-field-hint" style={{ marginTop: '0.35rem' }}>
              Hotel / stay on Acefone uses the same live Nexora inventory tool as Simulator when
              NEXORA_FACTS_QUERY_URL is configured on the API.
            </p>
          ) : null}
        </div>

        <div className="studio-field">
          <label htmlFor="outPhone">Phone number to dial</label>
          <input
            id="outPhone"
            type="tel"
            placeholder="+91 98765 43210"
            value={toNumber}
            disabled={placing || liveCall}
            onChange={(e) => setToNumber(e.target.value)}
          />
        </div>

        <div className="studio-field">
          <label htmlFor="outName">Prospect name (optional)</label>
          <input
            id="outName"
            type="text"
            value={prospectName}
            disabled={placing || liveCall}
            onChange={(e) => setProspectName(e.target.value)}
          />
        </div>

        <div className="studio-field">
          <label htmlFor="outEmail">Contact email (optional)</label>
          <input
            id="outEmail"
            type="email"
            value={contactEmail}
            disabled={placing || liveCall}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>

        {combinedError ? <p className="sim-error">{combinedError}</p> : null}

        <button
          type="button"
          className="sim-start-btn"
          disabled={placing || liveCall}
          onClick={() => {
            if (ended) {
              resetForAnother();
              return;
            }
            void placeCall();
          }}
        >
          {placing ? 'Placing call…' : ended ? 'Place another call' : 'Place call'}
        </button>

        {!callId ? (
          <p className="sim-hint" style={{ marginTop: '1rem', fontSize: '0.875rem', opacity: 0.8 }}>
            {transport === 'livekit_sip' ? (
              <>
                Requires <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code>,{' '}
                <code>LIVEKIT_API_SECRET</code>, <code>LIVEKIT_SIP_OUTBOUND_TRUNK</code>, and{' '}
                <code>npm run dev:agent-v2</code>.
              </>
            ) : (
              <>
                Requires Smartflo API Token + Click-to-Call key. Set{' '}
                <code>SMARTFLO_API_TOKEN</code> and <code>ACEFONE_CLICK_TO_CALL_API_KEY</code> in
                apps/api/.env.
              </>
            )}
          </p>
        ) : null}
      </div>

      {showLivePanels ? (
        <>
          <div className="sim-panels">
            <LiveTranscriptPanel
              lines={lastSummary?.transcript ?? live.lines}
              userLabel="Prospect"
              emptyMessage={
                status === 'ringing' || status === 'initiating'
                  ? 'Waiting for the prospect to answer…'
                  : 'Waiting for the agent opener…'
              }
            />
            <section className="sim-panel sim-metrics">
              <div className="sim-panel-head">
                <span className="sim-panel-icon" aria-hidden>
                  📊
                </span>
                <h2>Metrics & usage</h2>
              </div>
              <div className="sim-metrics-pills">
                <div className="sim-stat-pill">
                  <span className="sim-stat-pill-label">Duration</span>
                  <span className="sim-stat-pill-value">{formatDuration(displayMetrics.callDurationSec)}</span>
                </div>
                <div className="sim-stat-pill">
                  <span className="sim-stat-pill-label">Prospect turns</span>
                  <span className="sim-stat-pill-value">{displayMetrics.userTurns}</span>
                </div>
                <div className="sim-stat-pill">
                  <span className="sim-stat-pill-label">Agent turns</span>
                  <span className="sim-stat-pill-value">{displayMetrics.agentTurns}</span>
                </div>
                <div className="sim-stat-pill">
                  <span className="sim-stat-pill-label">STT (last)</span>
                  <span className="sim-stat-pill-value">
                    {displayMetrics.lastSttMs != null ? `${Math.round(displayMetrics.lastSttMs)} ms` : '—'}
                  </span>
                </div>
              </div>
              <LatencyReadout metrics={displayMetrics} />
              <S2sEstimatedUsagePanel
                metrics={displayMetrics}
                provider="gemini"
              />
            </section>
          </div>
          <TelephonyLogPanel
            logs={[
              ...(lastTransportEcho
                ? [
                    {
                      id: 'transport-echo',
                      ts: Date.now(),
                      level: 'info' as const,
                      category: 'transport',
                      message: `selected=${lastTransportEcho.selected} returned=${lastTransportEcho.returned ?? '—'} provider=${lastTransportEcho.provider ?? '—'} path=${lastTransportEcho.selectedPath ?? '—'}${lastTransportEcho.debugMessage ? ` — ${lastTransportEcho.debugMessage}` : ''}`,
                    },
                  ]
                : []),
              ...live.logs,
            ]}
          />
        </>
      ) : null}

      {ended && lastSummary ? (
        <CallSummaryPanel
          metrics={lastSummary.metrics}
          transcript={lastSummary.transcript}
          formatDuration={formatDuration}
          latencyReadout={<LatencyReadout metrics={lastSummary.metrics} />}
          usagePanel={
            <S2sEstimatedUsagePanel
              metrics={lastSummary.metrics}
              provider="gemini"
            />
          }
        />
      ) : null}
    </div>
  );
}
