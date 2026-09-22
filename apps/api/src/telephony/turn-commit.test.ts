import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTelephonyLatencyTuning } from './latency-profile.js';
import {
  shouldTelephonyCommitUserTurn,
  telephonyCommitDelayMs,
} from './turn-commit.js';

describe('telephony latency tuning', () => {
  it('low profile uses tighter commit delays', () => {
    const low = getTelephonyLatencyTuning('low');
    assert.equal(low.commitCompleteMs, 200);
    assert.equal(low.sttSilenceMs, 350);
  });
});

describe('telephonyCommitDelayMs', () => {
  it('uses complete delay for direct questions', () => {
    const tuning = getTelephonyLatencyTuning('low');
    assert.equal(
      telephonyCommitDelayMs('Virtus ka price kya hai?', tuning),
      tuning.commitCompleteMs,
    );
  });
});

describe('shouldTelephonyCommitUserTurn', () => {
  it('commits after cap even for incomplete text', () => {
    const tuning = getTelephonyLatencyTuning('low');
    assert.equal(
      shouldTelephonyCommitUserTurn({
        text: 'toh',
        now: 1000,
        lastSttAt: 1000 - tuning.commitCapMs,
        tuning,
      }),
      true,
    );
  });
});
