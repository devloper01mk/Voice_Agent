import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agentTurnRequestedPhoneCapture,
  isPhoneCaptureActive,
  looksLikePhoneDigitUtterance,
  shouldRunPhoneProtocol,
} from './phone-protocol.ts';

describe('phone-protocol', () => {
  it('detects phone ask turns', () => {
    assert.equal(agentTurnRequestedPhoneCapture('Apna 10 digit mobile number boliye'), true);
    assert.equal(agentTurnRequestedPhoneCapture('What is your email?'), false);
  });

  it('isPhoneCaptureActive checks recent turns', () => {
    assert.equal(isPhoneCaptureActive('ok', ['Share your WhatsApp number']), true);
    assert.equal(isPhoneCaptureActive('ok', ['Hello']), false);
  });

  it('shouldRunPhoneProtocol follows assistant phone asks', () => {
    assert.equal(shouldRunPhoneProtocol('Please share your phone number'), true);
    assert.equal(shouldRunPhoneProtocol('Tell me about the car'), false);
  });

  it('looksLikePhoneDigitUtterance accepts Indian mobiles', () => {
    assert.equal(looksLikePhoneDigitUtterance('9078802278'), true);
    assert.equal(looksLikePhoneDigitUtterance('john at gmail dot com'), false);
  });
});
