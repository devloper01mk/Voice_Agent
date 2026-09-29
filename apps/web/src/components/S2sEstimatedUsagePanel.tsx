import {
  estimateS2sCallCost,
  formatInr,
  formatTokenCount,
  formatUsd,
  resolveS2sCostProvider,
  s2sUsageFromMetrics,
  type S2sCostProvider,
} from '@vsa/shared';
import type { CallMetricsSummary } from '../api';

export default function S2sEstimatedUsagePanel({
  metrics,
  provider,
  model,
}: {
  metrics: CallMetricsSummary;
  provider?: string | null;
  model?: string | null;
}) {
  const costProvider: S2sCostProvider = resolveS2sCostProvider(provider, model);
  const usage = s2sUsageFromMetrics(metrics);
  const cost = estimateS2sCallCost(usage, costProvider);
  const hasUsage =
    usage.inputTextTokens > 0 ||
    usage.inputAudioTokens > 0 ||
    usage.outputTextTokens > 0 ||
    usage.outputAudioTokens > 0 ||
    usage.totalTokens > 0;

  const providerLabel = 'Gemini Live';

  if (!hasUsage) {
    return (
      <p className="muted cost-footnote">
        S2S usage and cost appear after the first model turn (audio/text tokens from the Live API).
      </p>
    );
  }

  return (
    <div className="usage-cost-panels">
      <div className="cost-estimate usage-estimate">
        <div className="cost-total">
          <span className="cost-total-label">S2S token usage</span>
          <span className="cost-total-value usage-total-value">
            {formatTokenCount(usage.totalTokens)} tokens
          </span>
        </div>
        <ul className="cost-lines">
          <li>
            <span>Input text</span>
            <span className="usage-line-value">{formatTokenCount(usage.inputTextTokens)}</span>
          </li>
          <li>
            <span>Input audio</span>
            <span className="usage-line-value">{formatTokenCount(usage.inputAudioTokens)}</span>
          </li>
          <li>
            <span>Output text</span>
            <span className="usage-line-value">{formatTokenCount(usage.outputTextTokens)}</span>
          </li>
          <li>
            <span>Output audio</span>
            <span className="usage-line-value">{formatTokenCount(usage.outputAudioTokens)}</span>
          </li>
        </ul>
      </div>

      <div className="cost-estimate">
        <div className="cost-total">
          <span className="cost-total-label">Estimated S2S cost</span>
          <span className="cost-total-value">
            {formatInr(cost.totalInr)}
            <span className="usage-line-detail"> · {formatUsd(cost.totalUsd)}</span>
          </span>
        </div>
        <ul className="cost-lines">
          <li>
            <span>Input text</span>
            <span>{formatUsd(cost.inputTextUsd)}</span>
          </li>
          <li>
            <span>Input audio</span>
            <span>{formatUsd(cost.inputAudioUsd)}</span>
          </li>
          <li>
            <span>Output text</span>
            <span>{formatUsd(cost.outputTextUsd)}</span>
          </li>
          <li>
            <span>Output audio</span>
            <span>{formatUsd(cost.outputAudioUsd)}</span>
          </li>
        </ul>
        <p className="muted cost-footnote">
          Estimated from published {providerLabel} token rates across {usage.turns || 0} turn
          {usage.turns === 1 ? '' : 's'}. Gemini may re-bill conversation context each turn.
        </p>
      </div>
    </div>
  );
}
