import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHoldRequest, isHoldResumeCue, shouldExitHold } from './call-hold.ts';

describe('isHoldRequest', () => {
  it('detects common Hindi/Hinglish hold phrases', () => {
    assert.equal(isHoldRequest('ek min'), true);
    assert.equal(isHoldRequest('eka minute'), true);
    assert.equal(isHoldRequest('hold karna'), true);
    assert.equal(isHoldRequest('hold karo'), true);
    assert.equal(isHoldRequest('ruk jao'), true);
    assert.equal(isHoldRequest('thoda wait'), true);
    assert.equal(isHoldRequest('bas ek second'), true);
    assert.equal(isHoldRequest('one minute'), true);
  });

  it('does not treat delivery wait questions as hold', () => {
    assert.equal(isHoldRequest('delivery wait time kitna hota hai for Virtus'), false);
    assert.equal(isHoldRequest('what is the waitlist for the car'), false);
  });
});

describe('isHoldResumeCue', () => {
  it('detects short resume cues', () => {
    assert.equal(isHoldResumeCue('hello'), true);
    assert.equal(isHoldResumeCue('haji'), true);
    assert.equal(isHoldResumeCue('haan bolo'), true);
    assert.equal(isHoldResumeCue('ji'), true);
    assert.equal(isHoldResumeCue('ji boliye'), true);
    assert.equal(isHoldResumeCue('main aa gaya'), true);
  });

  it('ignores bare haan and side talk', () => {
    assert.equal(isHoldResumeCue('haan'), false);
    assert.equal(isHoldResumeCue('arre form kahan hai nahi ye wala'), false);
  });
});

describe('shouldExitHold', () => {
  it('exits on resume cue or product talk, stays on side talk', () => {
    assert.equal(shouldExitHold('haji'), true);
    assert.equal(shouldExitHold('Virtus ki price batao'), true);
    assert.equal(shouldExitHold('arre woo form kahan hai nahi ye wala'), false);
    assert.equal(shouldExitHold('haan'), false);
  });
});
