import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_VOICE_PIPELINE,
  isGeminiLivePipeline,
  normalizeVoicePipeline,
  resolveRealtimeVoice,
} from './voice-pipeline.js';

describe('voice-pipeline', () => {
  it('always normalizes to gemini_live', () => {
    assert.equal(normalizeVoicePipeline(undefined), DEFAULT_VOICE_PIPELINE);
    assert.equal(normalizeVoicePipeline('nope'), 'gemini_live');
    assert.equal(normalizeVoicePipeline('cascaded'), 'gemini_live');
    assert.equal(normalizeVoicePipeline('openai_realtime'), 'gemini_live');
    assert.equal(DEFAULT_VOICE_PIPELINE, 'gemini_live');
  });

  it('treats all pipelines as Gemini Live', () => {
    assert.equal(isGeminiLivePipeline('cascaded'), true);
    assert.equal(isGeminiLivePipeline('openai_realtime'), true);
  });

  it('resolves realtime voice with trim and default', () => {
    assert.equal(resolveRealtimeVoice('  Kore  '), 'Kore');
    assert.equal(resolveRealtimeVoice(null), 'Kore');
  });
});
