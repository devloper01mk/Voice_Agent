import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendHinglishGenderLock,
  lockSpokenHinglishGender,
  spokenUsesWrongHinglishGender,
} from './hinglish-gender.ts';

describe('lockSpokenHinglishGender female', () => {
  it('rewrites karta/chahta hun and karunga', () => {
    assert.equal(
      lockSpokenHinglishGender('Main check karta hun, room chahta hu.', 'female'),
      'Main check karti hoon, room chahti hoon.',
    );
    assert.equal(lockSpokenHinglishGender('Main book karunga.', 'female'), 'Main book karungi.');
  });

  it('rewrites chate/chata hu as the user hears it', () => {
    assert.match(lockSpokenHinglishGender('Main yahi chate hu', 'female'), /chahti hoon/i);
    assert.match(lockSpokenHinglishGender('Main yahi chata hu', 'female'), /chahti hoon/i);
  });

  it('rewrites bol raha hoon to bol rehi hoon', () => {
    assert.equal(
      lockSpokenHinglishGender('Main Neha bol raha hoon', 'female'),
      'Main Neha bol rehi hoon',
    );
  });

  it('rewrites kar rahi hoon to kar rehi hoon for female TTS', () => {
    assert.equal(
      lockSpokenHinglishGender('Ek second, main note kar rahi hoon.', 'female'),
      'Ek second, main note kar rehi hoon.',
    );
  });

  it('does not rewrite third-person karta hai', () => {
    assert.equal(
      lockSpokenHinglishGender('Yeh guest karta hai late check-in', 'female'),
      'Yeh guest karta hai late check-in',
    );
  });

  it('is idempotent', () => {
    const once = lockSpokenHinglishGender('Main karti hoon check', 'female');
    assert.equal(lockSpokenHinglishGender(once, 'female'), once);
  });
});

describe('lockSpokenHinglishGender male', () => {
  it('rewrites karti hoon to karta hoon', () => {
    assert.equal(
      lockSpokenHinglishGender('Main check karti hoon', 'male'),
      'Main check karta hoon',
    );
  });

  it('rewrites note kar rahi hoon to kar raha hoon', () => {
    assert.equal(
      lockSpokenHinglishGender('Ek second, main note kar rahi hoon.', 'male'),
      'Ek second, main note kar raha hoon.',
    );
  });
});

describe('spokenUsesWrongHinglishGender', () => {
  it('flags masculine first-person for a female agent', () => {
    assert.equal(spokenUsesWrongHinglishGender('Main karta hun booking', 'female'), true);
    assert.equal(spokenUsesWrongHinglishGender('Main karti hoon booking', 'female'), false);
  });
});

describe('appendHinglishGenderLock', () => {
  it('keeps the lock at the end after compression', () => {
    const long = `${'Product Knowledge. '.repeat(400)}\n## Other\n${'x'.repeat(2000)}`;
    const out = appendHinglishGenderLock(long, 'female', 1200);
    assert.match(out, /Hinglish speaker grammar lock/);
    assert.match(out, /karti hoon/);
    assert.ok(out.indexOf('Hinglish speaker grammar lock') > out.indexOf('trimmed for phone') || out.length < 2000);
    assert.ok(out.endsWith('karunga.') || /Never say karta/.test(out.slice(-200)));
  });

  it('keeps sections appended after an earlier lock', () => {
    const withLock = appendHinglishGenderLock('You are Riya.\n\n## Safety\nBe safe.', 'female');
    const out = appendHinglishGenderLock(
      `${withLock}\n\n## Gemini Live speech-to-speech\n- Keep replies short.`,
      'female',
    );
    assert.match(out, /## Gemini Live speech-to-speech/);
    assert.equal(out.match(/Hinglish speaker grammar lock/g)?.length, 1);
    assert.ok(out.indexOf('Gemini Live speech') < out.indexOf('Hinglish speaker grammar lock'));
  });

  it('compresses by section priority instead of dropping the middle', () => {
    const filler = (label: string) => Array.from({ length: 60 }, (_, i) => `- ${label} rule ${i}.`).join('\n');
    const prompt = [
      'You are Riya.',
      `## Language (critical)\n${filler('language')}`,
      `## Product Knowledge\n- Starter plan 999.\n${filler('catalog')}`,
      `## Sales & support skills (how to behave)\n- Answer first.\n${filler('skill')}`,
      `## Safety\n- DNC: end_call.\n${filler('safety')}`,
      `## Unlisted extras\n${filler('extra')}`,
    ].join('\n');
    const out = appendHinglishGenderLock(prompt, 'female', 2000);
    assert.ok(out.length <= 2000);
    assert.match(out, /Starter plan 999/);
    assert.match(out, /Answer first/);
    assert.match(out, /DNC: end_call/);
    assert.doesNotMatch(out, /## Unlisted extras/);
    assert.match(out, /Hinglish speaker grammar lock/);
  });
});
