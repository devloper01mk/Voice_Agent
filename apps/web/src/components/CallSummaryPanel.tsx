import type { ReactNode } from 'react';
import type { CallMetricsSummary, TranscriptLine } from '../api';

type CallSummaryPanelProps = {
  metrics: CallMetricsSummary;
  transcript: TranscriptLine[];
  formatDuration: (sec: number) => string;
  latencyReadout: ReactNode;
  usagePanel: ReactNode;
};

export default function CallSummaryPanel({
  metrics,
  transcript,
  formatDuration,
  latencyReadout,
  usagePanel,
}: CallSummaryPanelProps) {
  return (
    <section className="sim-summary-panel">
      <div className="sim-summary-head">
        <span className="sim-summary-icon" aria-hidden>📋</span>
        <div>
          <h2 className="sim-summary-title">Last call summary</h2>
          <p className="sim-summary-meta">
            {formatDuration(metrics.callDurationSec)} · {metrics.userTurns} your turns ·{' '}
            {metrics.agentTurns} agent turns
          </p>
        </div>
      </div>

      <div className="sim-summary-stats">
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

      <div className="sim-summary-grid">
        <div className="sim-summary-block">
          <h3>Latency</h3>
          {latencyReadout}
        </div>
        <div className="sim-summary-block">
          <h3>Usage & cost</h3>
          {usagePanel}
        </div>
      </div>

      <div className="sim-summary-block sim-summary-block--full">
        <h3>Transcript</h3>
        <div className="transcript-feed compact">
          {transcript.map((line) => (
            <div key={line.id} className={`transcript-line ${line.role}`}>
              <span className="transcript-role">{line.role === 'user' ? 'You' : 'Agent'}</span>
              <span className="transcript-text">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
