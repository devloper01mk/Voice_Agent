import {
  estimateCallCost,
  formatAudioDurationMs,
  formatCharacterCount,
  formatTokenCount,
  formatUsd,
  usageDisplayFromMetrics,
  usageFromMetrics,
  type LlmProvider,
} from '@vsa/shared';
import type { CallMetricsSummary } from '../api';

export default function EstimatedUsagePanel({
  metrics,
  llmProvider,
}: {
  metrics: CallMetricsSummary;
  llmProvider: LlmProvider;
}) {
  const usage = usageFromMetrics(metrics);
  const display = usageDisplayFromMetrics(metrics);
  const cost = estimateCallCost(usage, llmProvider);
  const turns = metrics.userTurns + metrics.agentTurns;
  const hasUsage =
    usage.sttAudioDurationMs > 0 ||
    usage.llmPromptTokens > 0 ||
    usage.llmCompletionTokens > 0 ||
    usage.ttsCharacters > 0;

  if (!hasUsage) {
    return (
      <p className="muted cost-footnote">
        Usage and cost estimates appear after the first AI pipeline activity.
      </p>
    );
  }

  return (
    <div className="usage-cost-panels">
      <div className="cost-estimate usage-estimate">
        <div className="cost-total">
          <span className="cost-total-label">Estimated AI usage</span>
          <span className="cost-total-value usage-total-value">
            {formatTokenCount(display.llmTotalTokens)} tokens
          </span>
        </div>
        <ul className="cost-lines">
          <li>
            <span>Conversation (LLM)</span>
            <span className="usage-line-value">
              {formatTokenCount(display.llmTotalTokens)} tokens
              <span className="usage-line-detail">
                in {formatTokenCount(display.llmPromptTokens)}
                {display.llmCachedPromptTokens > 0
                  ? ` (${formatTokenCount(display.llmCachedPromptTokens)} cached)`
                  : ''}{' '}
                · out {formatTokenCount(display.llmCompletionTokens)}
              </span>
            </span>
          </li>
          <li>
            <span>Voice synthesis (Cartesia)</span>
            <span className="usage-line-value">
              {formatCharacterCount(display.ttsCharacters)} characters
            </span>
          </li>
          <li>
            <span>Transcription (Azure Speech)</span>
            <span className="usage-line-value">
              {formatAudioDurationMs(display.sttAudioDurationMs)} audio
            </span>
          </li>
        </ul>
      </div>

      <div className="cost-estimate">
        <div className="cost-total">
          <span className="cost-total-label">Estimated AI cost</span>
          <span className="cost-total-value">{formatUsd(cost.totalUsd)}</span>
        </div>
        <ul className="cost-lines">
          <li>
            <span>Conversation (LLM)</span>
            <span>{formatUsd(cost.llmUsd)}</span>
          </li>
          <li>
            <span>Voice synthesis (Cartesia)</span>
            <span>{formatUsd(cost.ttsUsd)}</span>
          </li>
          <li>
            <span>Transcription (Azure Speech)</span>
            <span>{formatUsd(cost.sttUsd)}</span>
          </li>
        </ul>
        <p className="muted cost-footnote">
          Estimated from published per-use pricing across {turns || 0} turn
          {turns === 1 ? '' : 's'}.
        </p>
      </div>
    </div>
  );
}
