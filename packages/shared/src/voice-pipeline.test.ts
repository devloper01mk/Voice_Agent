import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_REALTIME_VOICE,
  DEFAULT_VOICE_PIPELINE,
  buildRealtimeS2sInstructionSupplement,
  isOpenaiRealtimePipeline,
  normalizeVoicePipeline,
  resolveRealtimeVoice,
} from './voice-pipeline.js';

describe('voice-pipeline', () => {
  it('defaults unknown pipelines to cascaded', () => {
    assert.equal(normalizeVoicePipeline(undefined), DEFAULT_VOICE_PIPELINE);
    assert.equal(normalizeVoicePipeline('nope'), 'cascaded');
    assert.equal(normalizeVoicePipeline('openai_realtime'), 'openai_realtime');
  });

  it('resolves realtime voices with coral fallback', () => {
    assert.equal(resolveRealtimeVoice(undefined), DEFAULT_REALTIME_VOICE);
    assert.equal(resolveRealtimeVoice('coral'), 'coral');
    assert.equal(resolveRealtimeVoice('  custom-voice  '), 'custom-voice');
  });

  it('detects openai realtime pipeline', () => {
    assert.equal(isOpenaiRealtimePipeline('openai_realtime'), true);
    assert.equal(isOpenaiRealtimePipeline('cascaded'), false);
  });

  it('builds S2S instruction supplement for simulator', () => {
    const note = buildRealtimeS2sInstructionSupplement('coral');
    assert.match(note, /schedule_callback/);
    assert.match(note, /Simulator only/i);
    assert.match(note, /female/i);
    assert.match(note, /karti hoon|bol rehi hoon/);
    assert.doesNotMatch(note, /bol rahi hoon/);
  });
});
