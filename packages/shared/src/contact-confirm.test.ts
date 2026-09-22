import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildContactConfirmPrompt,
  expandDigitsToEnglishWords,
  spokenPhoneForReadBack,
} from './contact-confirm.ts';

describe('expandDigitsToEnglishWords', () => {
  it('expands digit runs to English digit words', () => {
    assert.equal(expandDigitsToEnglishWords('manish1934'), 'manish one nine three four');
    assert.equal(expandDigitsToEnglishWords('a1b2'), 'a one b two');
  });
});

describe('spokenPhoneForReadBack', () => {
  it('always uses English digit words even when hi locale is requested', () => {
    assert.equal(
      spokenPhoneForReadBack('9078802278', 'hi'),
      'nine zero, seven eight, eight zero, two two, seven eight',
    );
  });
});

describe('buildContactConfirmPrompt', () => {
  it('is tool safety, not a spoken script', () => {
    const prompt = buildContactConfirmPrompt({});
    assert.match(prompt, /ALWAYS English digit words/i);
    assert.match(prompt, /Price \/ amount \/ time \/ weight \/ height \/ age/i);
    assert.match(prompt, /Phone, OTP, PIN/i);
    assert.match(prompt, /Never ask for email/i);
    assert.match(prompt, /email_skipped=true/i);
    assert.match(prompt, /name_confirmed=true/i);
    assert.match(prompt, /phone_confirmed=true/i);
    assert.match(prompt, /NEVER announce a booking/i);
    assert.match(prompt, /update_demo_lead_name/i);
    assert.match(prompt, /X nahi Y/i);
    assert.match(prompt, /Never invent digits/i);
    assert.match(prompt, /not a required conversation path/i);
    assert.doesNotMatch(prompt, /Maine suna \{name\}/);
    assert.doesNotMatch(prompt, /confirm kar lungi/);
  });
});
