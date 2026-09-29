import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  looksLikeHumanReply,
  looksLikeVoicemailPrompt,
  silenceStep,
} from './phone-silence.js';

describe('phone silence', () => {
  it('asks three times then ends on the third check', () => {
    assert.equal(silenceStep(0), 'check');
    assert.equal(silenceStep(1), 'check');
    assert.equal(silenceStep(2), 'check_then_end');
  });

  it('treats a mailbox greeting as voicemail, not a person', () => {
    assert.equal(
      looksLikeVoicemailPrompt('The person you are trying to reach is not available. Please leave a message after the tone.'),
      true,
    );
    assert.equal(looksLikeHumanReply('leave a message after the beep'), false);
    assert.equal(looksLikeHumanReply('Bhaiya ji Udaipur'), true);
    assert.equal(looksLikeHumanReply('beep'), false);
  });
});
