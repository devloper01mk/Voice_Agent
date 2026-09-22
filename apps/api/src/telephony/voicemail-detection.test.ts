import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildVoicemailMessage,
  classifyAmdSpeech,
} from './voicemail-detection.js';

describe('classifyAmdSpeech', () => {
  it('detects voicemail greetings', () => {
    assert.equal(
      classifyAmdSpeech('Please leave a message after the tone'),
      'voicemail',
    );
    assert.equal(
      classifyAmdSpeech('The person you are calling is not available'),
      'voicemail',
    );
  });

  it('detects human pickup', () => {
    assert.equal(classifyAmdSpeech('Hello'), 'human');
    assert.equal(classifyAmdSpeech('Haan boliye'), 'human');
    assert.equal(classifyAmdSpeech('Kaun hai?'), 'human');
  });

  it('uses cumulative context for longer greetings', () => {
    const cumulative =
      'Thank you for calling. The person you are trying to reach is unavailable. Please leave a message after the beep.';
    assert.equal(
      classifyAmdSpeech('after the beep', { cumulative }),
      'voicemail',
    );
  });
});

describe('buildVoicemailMessage', () => {
  it('fills agent and product placeholders', () => {
    const msg = buildVoicemailMessage(
      'Hi, this is {agent_name} from {product_name}.',
      'Maya',
      'Cronberry CRM',
    );
    assert.match(msg, /Maya/);
    assert.match(msg, /Cronberry CRM/);
  });
});
