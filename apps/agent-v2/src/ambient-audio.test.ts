import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { voice } from '@livekit/agents';
import {
  SIMULATOR2_AMBIENT_CLIP,
  SIMULATOR2_AMBIENT_VOLUME,
  buildSimulator2AmbientOptions,
} from './ambient-audio.js';

describe('Simulator 2.0 ambient audio', () => {
  it('uses soft office ambience without thinking sounds', () => {
    const options = buildSimulator2AmbientOptions();

    assert.equal(SIMULATOR2_AMBIENT_CLIP, voice.BuiltinAudioClip.OFFICE_AMBIENCE);
    assert.equal(SIMULATOR2_AMBIENT_VOLUME, 0.12);
    assert.deepEqual(options.ambientSound, {
      source: voice.BuiltinAudioClip.OFFICE_AMBIENCE,
      volume: 0.12,
    });
    assert.equal(options.thinkingSound, undefined);
  });
});
