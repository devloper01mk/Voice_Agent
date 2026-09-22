import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateCallCost } from './cost-estimate.ts';

describe('estimateCallCost prompt cache', () => {
  it('bills GPT cached prompt tokens at 10% of the input rate', () => {
    const full = estimateCallCost(
      {
        sttAudioDurationMs: 0,
        llmPromptTokens: 10_000,
        llmCachedPromptTokens: 0,
        llmCompletionTokens: 0,
        ttsCharacters: 0,
      },
      'gpt',
    );
    const cached = estimateCallCost(
      {
        sttAudioDurationMs: 0,
        llmPromptTokens: 10_000,
        llmCachedPromptTokens: 10_000,
        llmCompletionTokens: 0,
        ttsCharacters: 0,
      },
      'gpt',
    );
    assert.ok(full.llmUsd > 0);
    assert.equal(cached.llmUsd, full.llmUsd / 10);
  });
});
