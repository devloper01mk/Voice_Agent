import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatPhoneForSpeech,
  normalizeSpokenPhone,
  validateLeadPhone,
} from './phone-utils.ts';

describe('normalizeSpokenPhone', () => {
  it('strips non-digits and country code', () => {
    assert.equal(normalizeSpokenPhone('+91 98765 43210'), '9876543210');
  });

  it('handles double digit speech', () => {
    assert.equal(normalizeSpokenPhone('98 double 7 654321'), '9877654321');
  });

  it('parses Hindi digit words', () => {
    assert.equal(
      normalizeSpokenPhone('nau aath saat chhe paanch char teen do ek sunya'),
      '9876543210',
    );
  });
});

describe('formatPhoneForSpeech', () => {
  it('formats as English digit words in pairs by default', () => {
    assert.equal(
      formatPhoneForSpeech('9078802278'),
      'nine zero, seven eight, eight zero, two two, seven eight',
    );
    assert.equal(
      formatPhoneForSpeech('9876543210'),
      'nine eight, seven six, five four, three two, one zero',
    );
  });

  it('formats as Hindi digit words when locale is hi', () => {
    assert.equal(
      formatPhoneForSpeech('9078802278', 'hi'),
      'nau sunya, saat aath, aath sunya, do do, saat aath',
    );
    assert.equal(
      formatPhoneForSpeech('9876543210', 'hi'),
      'nau aath, saat chhe, paanch char, teen do, ek sunya',
    );
  });
});

describe('validateLeadPhone', () => {
  it('accepts valid Indian mobile', () => {
    const result = validateLeadPhone('9876543210');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.phone, '9876543210');
      assert.equal(
        result.formatted,
        'nine eight, seven six, five four, three two, one zero',
      );
    }
  });

  it('accepts spaced and +91 forms', () => {
    const result = validateLeadPhone('+91 98765 43210');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.phone, '9876543210');
  });

  it('accepts spoken digit words', () => {
    const result = validateLeadPhone(
      'nine eight seven six five four three two one zero',
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.phone, '9876543210');
  });

  it('formats Hindi when locale is hi', () => {
    const result = validateLeadPhone('9876543210', 'hi');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(
        result.formatted,
        'nau aath, saat chhe, paanch char, teen do, ek sunya',
      );
    }
  });

  it('rejects too short', () => {
    const result = validateLeadPhone('98765');
    assert.equal(result.ok, false);
  });

  it('rejects letter junk even when short after strip', () => {
    const result = validateLeadPhone('727770067Z');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /letters/i);
  });

  it('rejects letter junk even when digits alone would be valid', () => {
    const result = validateLeadPhone('98Z76543210');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /letters/i);
  });
});
