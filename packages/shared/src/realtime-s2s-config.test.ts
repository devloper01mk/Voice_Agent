import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SIMULATOR_FORCE_S2S_PRESET_ID,
  defaultRealtimeS2sUserConfig,
  normalizeRealtimeS2sUserConfig,
  realtimeS2sUserConfigToSessionConfig,
} from './realtime-s2s-config.js';
import { DEFAULT_GEMINI_LIVE_MODEL, DEFAULT_GEMINI_LIVE_VOICE } from './gemini-live-config.js';

describe('realtime-s2s-config', () => {
  it('defaults match Gemini Live preset', () => {
    const config = defaultRealtimeS2sUserConfig();
    assert.equal(config.model, DEFAULT_GEMINI_LIVE_MODEL);
    assert.equal(config.provider, 'gemini');
    assert.equal(config.voice, DEFAULT_GEMINI_LIVE_VOICE);
    assert.equal(config.turnDetectionThreshold, 0.5);
    assert.equal(config.turnDetectionSilenceDurationMs, 200);
  });

  it('normalizes partial user config and maps legacy OpenAI models to Gemini', () => {
    const config = normalizeRealtimeS2sUserConfig({
      model: 'gpt-realtime',
      voice: 'Kore',
      turnDetectionMode: 'semantic',
      turnDetectionEagerness: 'high',
    });
    assert.equal(config.model, DEFAULT_GEMINI_LIVE_MODEL);
    assert.equal(config.voice, 'Kore');
    assert.equal(config.turnDetectionMode, 'semantic');
    assert.equal(config.turnDetectionEagerness, 'high');
    assert.equal(config.provider, 'gemini');
  });

  it('builds session config from user settings', () => {
    const session = realtimeS2sUserConfigToSessionConfig(defaultRealtimeS2sUserConfig());
    assert.equal(session.presetId, SIMULATOR_FORCE_S2S_PRESET_ID);
    assert.equal(session.turnDetection.type, 'server_vad');
    assert.equal(session.maxResponseOutputTokens, 'unlimited');
  });

  it('maps semantic turn detection', () => {
    const session = realtimeS2sUserConfigToSessionConfig(
      normalizeRealtimeS2sUserConfig({ turnDetectionMode: 'semantic' }),
    );
    assert.equal(session.turnDetection.type, 'semantic_vad');
    assert.equal(session.turnDetection.eagerness, 'medium');
  });
});
