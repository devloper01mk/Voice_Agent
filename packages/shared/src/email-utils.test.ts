import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emailRequiresCallerConfirm, RFC_EMAIL_REGEX, validateLeadEmail } from './email-utils.ts';

describe('validateLeadEmail', () => {
  it('accepts RFC-shaped addresses', () => {
    const r = validateLeadEmail('Manish@Gmail.com');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.email, 'manish@gmail.com');
  });

  it('rejects empty and malformed', () => {
    assert.equal(validateLeadEmail('').ok, false);
    assert.equal(validateLeadEmail('not-an-email').ok, false);
    assert.equal(RFC_EMAIL_REGEX.test('a@b.com'), true);
  });
});

describe('emailRequiresCallerConfirm', () => {
  it('skips when confirmed or known match', () => {
    assert.equal(emailRequiresCallerConfirm('a@b.com', true), false);
    assert.equal(emailRequiresCallerConfirm('a@b.com', false, 'a@b.com'), false);
    assert.equal(emailRequiresCallerConfirm('a@b.com', false), true);
  });
});
