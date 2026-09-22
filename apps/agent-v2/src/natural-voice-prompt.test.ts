import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compactSystemPrompt, rewriteVoiceRulesForSimulator2 } from './compact-prompt.js';
import { getLatencyConfig } from './latency-profile.js';
import { buildSimulator2NaturalVoicePrompt } from './natural-voice-prompt.js';
import {
  resolveSimulator2TtsEmotion,
  SIMULATOR2_DEFAULT_TTS_EMOTION,
} from './voice-agent.js';

describe('Simulator 2.0 shared delivery', () => {
  it('uses the shared delivery block, not a second persona script', () => {
    const prompt = buildSimulator2NaturalVoicePrompt();
    assert.match(prompt, /1–2 short spoken sentences/);
    assert.match(prompt, /Opener is optional/);
    assert.match(prompt, /Anti-questionnaire/);
    assert.match(prompt, /kaise ho/);
    assert.match(prompt, /Some turns with no question are OK/);
    assert.match(prompt, /Arre wah/);
    assert.doesNotMatch(prompt, /Simulator 2.0 natural voice delivery/);
    assert.doesNotMatch(prompt, /Every spoken turn/);
  });

  it('enables preflight generation and responsive barge-in', () => {
    const config = getLatencyConfig();

    assert.equal(config.azureStt.preflightInterims, true);
    assert.equal(config.preemptiveGeneration.enabled, true);
    assert.equal(config.preemptiveGeneration.preemptiveTts, true);
    assert.ok(config.endpointing.maxDelay <= 1_000);
    assert.ok(config.interruption.minDuration <= 500);
    assert.equal(config.interruption.resumeFalseInterruption, true);
  });

  it('tunes telephony for faster barge-in and shorter AEC warmup', () => {
    const phone = getLatencyConfig('azure', { telephony: true });
    assert.ok(phone.interruption.minDuration <= 300);
    assert.equal(phone.interruption.minWords, 0);
    assert.ok((phone.aecWarmupDuration ?? 3000) <= 1000);
  });

  it('caps product context without swapping in an intent menu', () => {
    const longProduct = Array.from(
      { length: 200 },
      (_, index) => `Model ${index}: feature and pricing details.`,
    ).join('\n');
    const compiled = `Agent identity\n## Product Knowledge\n${longProduct}\n## How to understand the caller\nUnseen asks are valid.\n## Voice rules\nPlain speech.`;

    const compact = compactSystemPrompt(compiled, longProduct, 1_000, true);

    assert.doesNotMatch(compact, /Model 150:/);
    assert.match(compact, /Additional catalog details omitted in low-latency mode/);
    assert.match(compact, /How to understand the caller/);
    assert.doesNotMatch(compact, /## Skills \(short\)/);
    assert.match(compact, /## Voice rules/);
  });

  it('leaves voice rules unchanged (shared compiler owns delivery)', () => {
    const voice = `## Voice rules\n- Plain spoken text only.\n- Do not use casual filler exclamations (e.g. "Arre wah!") — reply directly and professionally.\n`;
    assert.equal(rewriteVoiceRulesForSimulator2(voice), voice);
  });

  it('defaults empty cascaded TTS emotion to happy', () => {
    assert.equal(resolveSimulator2TtsEmotion(''), SIMULATOR2_DEFAULT_TTS_EMOTION);
    assert.equal(resolveSimulator2TtsEmotion('neutral'), SIMULATOR2_DEFAULT_TTS_EMOTION);
    assert.equal(resolveSimulator2TtsEmotion(undefined), 'happy');
    assert.equal(resolveSimulator2TtsEmotion('enthusiastic'), 'enthusiastic');
  });
});
