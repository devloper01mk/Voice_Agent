import type { CallMetricsSummary } from '../api';

export function formatLatencyMs(ms?: number) {
  return ms != null ? `${Math.round(ms)} ms` : '— ms';
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function LatencyReadout({
  metrics,
  highlightFelt,
  feltTargetMs,
}: {
  metrics: CallMetricsSummary;
  highlightFelt?: boolean;
  feltTargetMs?: number;
}) {
  const feltResponseMs = metrics.lastFeltResponseMs ?? metrics.lastResponseLatencyMs;
  const rows = [
    ['Felt response:', formatLatencyMs(feltResponseMs)],
    ['Response latency:', formatLatencyMs(metrics.lastResponseLatencyMs)],
    ['EOU delay:', formatLatencyMs(metrics.lastEouDelayMs)],
    ['LLM TTFT:', formatLatencyMs(metrics.lastLlmTtftMs)],
    ['TTS TTFB:', formatLatencyMs(metrics.lastTtsTtfbMs)],
    ['Transcript E2E:', formatLatencyMs(metrics.lastE2eMs)],
  ] as const;

  const avg =
    metrics.avgFeltResponseMs != null && (metrics.feltResponseSamples ?? 0) > 1
      ? `felt avg ${Math.round(metrics.avgFeltResponseMs)} ms (${metrics.feltResponseSamples} turns)`
      : metrics.avgResponseLatencyMs != null && (metrics.responseLatencySamples ?? 0) > 1
        ? `avg ${Math.round(metrics.avgResponseLatencyMs)} ms (${metrics.responseLatencySamples} turns)`
        : null;

  return (
    <div
      className={`latency-readout${highlightFelt ? ' latency-readout-v2' : ''}`}
      aria-label="Pipeline latency"
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          className={`latency-row${label.startsWith('Felt') ? ' latency-row-primary' : ''}`}
        >
          <span className="latency-label">{label}</span>
          <span className="latency-value">{value}</span>
        </div>
      ))}
      {avg ? <p className="muted latency-avg">{avg}</p> : null}
      {highlightFelt && feltTargetMs != null ? (
        <p
          className={`latency-target ${
            feltResponseMs == null
              ? 'latency-target-pending'
              : feltResponseMs <= feltTargetMs
                ? 'latency-target-met'
                : 'latency-target-missed'
          }`}
        >
          Target ≤ {feltTargetMs.toLocaleString()} ms:{' '}
          {feltResponseMs == null
            ? 'waiting for first response'
            : feltResponseMs <= feltTargetMs
              ? 'met'
              : `${Math.round(feltResponseMs - feltTargetMs)} ms over`}
        </p>
      ) : null}
      {metrics.lastTurnBundled ? (
        <p className="muted latency-avg">Last turn: bundled metrics (same utterance)</p>
      ) : null}
    </div>
  );
}
