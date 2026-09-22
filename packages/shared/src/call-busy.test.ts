import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isBareDurationTurn,
  isClearBusyOrCallbackTurn,
  buildCallbackSystemNote,
  looksLikeGarbageTranscript,
  shouldMuteBareDurationTurn,
} from './call-busy.ts';

describe('isBareDurationTurn', () => {
  it('detects lone durations', () => {
    assert.equal(isBareDurationTurn('One hour'), true);
    assert.equal(isBareDurationTurn('ek ghanta'), true);
    assert.equal(isBareDurationTurn('10 minutes'), true);
    assert.equal(isBareDurationTurn('half hour'), true);
  });

  it('rejects longer sentences', () => {
    assert.equal(isBareDurationTurn('call me in one hour'), false);
    assert.equal(isBareDurationTurn('delivery wait one hour for Virtus'), false);
  });
});

describe('shouldMuteBareDurationTurn', () => {
  it('mutes bare duration but not clear busy', () => {
    assert.equal(shouldMuteBareDurationTurn('One hour'), true);
    assert.equal(shouldMuteBareDurationTurn('call me in one hour'), false);
    assert.equal(shouldMuteBareDurationTurn('I am busy right now'), false);
  });
});

describe('isClearBusyOrCallbackTurn', () => {
  it('detects busy cues', () => {
    assert.equal(isClearBusyOrCallbackTurn('call me in one hour'), true);
    assert.equal(isClearBusyOrCallbackTurn('I am busy'), true);
    assert.equal(isClearBusyOrCallbackTurn('baad mein call karna'), true);
  });

  it('detects callback even when mixed with soft refusal', () => {
    assert.equal(
      isClearBusyOrCallbackTurn('mujhe nahi chahiye thodi der baad phone karo'),
      true,
    );
    assert.equal(
      isClearBusyOrCallbackTurn('ठीक है मुझे नहीं चाहिए थोड़ी देर बाद फ़ोन करेंगे'),
      true,
    );
    assert.equal(isClearBusyOrCallbackTurn('हाँ मिलेगा call kahan se'), false);
  });
});

describe('buildCallbackSystemNote', () => {
  it('steers LLM to schedule_callback not DNC', () => {
    const note = buildCallbackSystemNote();
    assert.match(note, /schedule_callback/);
    assert.match(note, /NOT DNC/);
    assert.match(note, /never call again/i);
  });
});

describe('looksLikeGarbageTranscript', () => {
  it('flags Metro Bhee style junk', () => {
    assert.equal(looksLikeGarbageTranscript('Metro Bhee'), true);
    assert.equal(looksLikeGarbageTranscript('Mein SUV'), false);
    assert.equal(looksLikeGarbageTranscript('SUV dekh raha hoon'), false);
  });
});
