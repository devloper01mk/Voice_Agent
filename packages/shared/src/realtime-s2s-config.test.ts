import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SIMULATOR_FORCE_S2S_PRESET_ID,
  defaultRealtimeS2sUserConfig,
  normalizeRealtimeS2sUserConfig,
  realtimeS2sUserConfigToSessionConfig,
} from './realtime-s2s-config.js';

describe('realtime-s2s-config', () => {
  it('defaults match screenshot preset', () => {
    const config = defaultRealtimeS2sUserConfig();
    assert.equal(config.model, 'gpt-realtime-mini');
    assert.equal(config.transcriptionModel, 'gpt-realtime-whisper');
    assert.equal(config.voice, 'coral');
    assert.equal(config.turnDetectionThreshold, 0.5);
    assert.equal(config.turnDetectionSilenceDurationMs, 500);
  });

  it('normalizes partial user config', () => {
    const config = normalizeRealtimeS2sUserConfig({
      model: 'gpt-realtime',
      voice: 'coral',
      turnDetectionMode: 'semantic',
      turnDetectionEagerness: 'high',
    });
    assert.equal(config.model, 'gpt-realtime');
    assert.equal(config.voice, 'coral');
    assert.equal(config.turnDetectionMode, 'semantic');
    assert.equal(config.turnDetectionEagerness, 'high');
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
