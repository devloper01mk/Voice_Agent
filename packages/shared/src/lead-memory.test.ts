import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLeadMemoryRulesPrompt,
  formatOpenBookingSummary,
  isCallerPriorRecallCue,
  isConsumedLead,
  isOpenLead,
  isWithinLeadMemoryWindow,
  leadMemoryCutoffDate,
  normalizeLeadMemoryRetentionHours,
} from './lead-memory.js';

describe('lead-memory', () => {
  it('normalizes retention presets and defaults to 48h', () => {
    assert.equal(normalizeLeadMemoryRetentionHours(24), 24);
    assert.equal(normalizeLeadMemoryRetentionHours(0), 0);
    assert.equal(normalizeLeadMemoryRetentionHours(99), 48);
    assert.equal(normalizeLeadMemoryRetentionHours(undefined), 48);
  });

  it('treats retention Off as no window', () => {
    assert.equal(leadMemoryCutoffDate(0), null);
    assert.equal(isWithinLeadMemoryWindow(new Date(), 0), false);
  });

  it('classifies open vs consumed leads', () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    assert.equal(
      isOpenLead({ status: 'confirmed', scheduledStart: '2026-09-20T10:00:00.000Z' }, now),
      true,
    );
    assert.equal(
      isConsumedLead({ status: 'completed', scheduledStart: '2026-09-10T10:00:00.000Z' }, now),
      true,
    );
    assert.equal(
      isConsumedLead({ status: 'new', scheduledEnd: '2026-09-01T10:00:00.000Z' }, now),
      true,
    );
    assert.equal(isOpenLead({ status: 'cancelled' }, now), false);
  });

  it('detects prior-recall cues', () => {
    assert.equal(isCallerPriorRecallCue('pehle bhi baat hui thi'), true);
    assert.equal(isCallerPriorRecallCue('last time maine book kiya tha'), true);
    assert.equal(isCallerPriorRecallCue('features kya hain'), false);
  });

  it('builds memory rules and open booking line', () => {
    assert.match(buildLeadMemoryRulesPrompt(0), /Off/i);
    assert.match(buildLeadMemoryRulesPrompt(48), /Never volunteer/i);
    assert.match(
      formatOpenBookingSummary({
        bookingType: 'demo',
        status: 'confirmed',
        scheduledStart: '2026-09-20T10:00:00.000Z',
      }),
      /demo/,
    );
  });
});
