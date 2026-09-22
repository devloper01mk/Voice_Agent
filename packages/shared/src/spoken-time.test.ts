import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatSpokenSlotAlternative,
  formatSpokenSlotAlternatives,
  prepareEnglishLockSpeech,
  rewriteClockTimesForSpeech,
  rewriteHindiQuantityWordsForEnglishSpeech,
  rewriteRahiForSpeech,
  spokenClockTime,
} from './spoken-time.ts';

describe('spokenClockTime', () => {
  it('speaks English on-the-hour without a colon', () => {
    assert.equal(spokenClockTime(13, 0, 'en'), '1 PM');
    assert.equal(spokenClockTime(12, 0, 'en'), '12 PM');
    assert.equal(spokenClockTime(0, 0, 'en'), '12 AM');
    assert.equal(spokenClockTime(10, 0, 'en'), '10 AM');
    assert.doesNotMatch(spokenClockTime(13, 0, 'en'), /:/);
  });

  it('speaks English minutes as words without a colon', () => {
    assert.equal(spokenClockTime(13, 30, 'en'), 'one thirty PM');
    assert.equal(spokenClockTime(13, 45, 'en'), 'one forty-five PM');
    assert.equal(spokenClockTime(13, 15, 'en'), 'one fifteen PM');
    assert.doesNotMatch(spokenClockTime(13, 30, 'en'), /:/);
  });

  it('speaks Hinglish clock forms without a colon', () => {
    assert.equal(spokenClockTime(13, 0, 'hinglish'), 'ek baje');
    assert.equal(spokenClockTime(13, 30, 'hinglish'), 'derh baje');
    assert.equal(spokenClockTime(14, 30, 'hi'), 'dhai baje');
    assert.equal(spokenClockTime(12, 0, 'hinglish'), 'barah baje');
    assert.doesNotMatch(spokenClockTime(13, 30, 'hinglish'), /:/);
  });
});

describe('rewriteClockTimesForSpeech', () => {
  it('rewrites 1:00 PM and 1:30 PM without colon', () => {
    assert.equal(rewriteClockTimesForSpeech('1:00 PM', 'en'), '1 PM');
    assert.equal(rewriteClockTimesForSpeech('1:30 pm', 'en'), 'one thirty PM');
    assert.equal(rewriteClockTimesForSpeech('1:45 PM', 'en'), 'one forty-five PM');
    assert.doesNotMatch(rewriteClockTimesForSpeech('1:00 PM', 'en'), /:/);
    assert.doesNotMatch(rewriteClockTimesForSpeech('1:30 PM', 'en'), /:/);
  });

  it('rewrites slot offer sentences for English', () => {
    const out = rewriteClockTimesForSpeech(
      'Tuesday, 4 August at 1:00 PM, 1:45 PM, or 2:30 PM — which one works?',
      'en',
    );
    assert.doesNotMatch(out, /:/);
    assert.match(out, /1 PM/);
    assert.match(out, /one forty-five PM/);
    assert.match(out, /two thirty PM/);
  });

  it('rewrites to Hinglish when lang is hinglish', () => {
    const out = rewriteClockTimesForSpeech('Kal 1:00 PM theek hai?', 'hinglish');
    assert.doesNotMatch(out, /:/);
    assert.match(out, /ek baje/);
  });

  it('strips leftover digit-colon even without am/pm', () => {
    assert.doesNotMatch(rewriteClockTimesForSpeech('meet at 1:00', 'en'), /:/);
    assert.doesNotMatch(rewriteClockTimesForSpeech('1:', 'en'), /:/);
  });

  it('preserves leading/trailing spaces so stream chunks do not glue words', () => {
    assert.equal(rewriteClockTimesForSpeech('Good ', 'en'), 'Good ');
    assert.equal(rewriteClockTimesForSpeech(' morning', 'en'), ' morning');
    assert.equal(rewriteClockTimesForSpeech('Volkswagen ', 'en'), 'Volkswagen ');
    const chunks = [
      'Good ',
      'morning, ',
      'Volkswagen ',
      'India ',
      'mein ',
      'Neha ',
      'bol ',
      'rahi ',
      'hoon.',
    ];
    const joined = chunks.map((c) => rewriteClockTimesForSpeech(c, 'en')).join('');
    assert.match(joined, /Good morning/);
    assert.match(joined, /Volkswagen India/);
    assert.match(joined, /bol rehi hoon/);
    assert.doesNotMatch(joined, /Goodmorning/);
    assert.doesNotMatch(joined, /\brahi\b/);
  });
});

describe('rewriteHindiQuantityWordsForEnglishSpeech', () => {
  it('rewrites das lakh and do baje to English', () => {
    assert.match(
      rewriteHindiQuantityWordsForEnglishSpeech('budget das lakh'),
      /ten lakh/i,
    );
    assert.doesNotMatch(rewriteHindiQuantityWordsForEnglishSpeech('budget das lakh'), /\bdas\b/i);
    assert.match(
      rewriteHindiQuantityWordsForEnglishSpeech('call at do baje'),
      /two o'clock/i,
    );
    assert.doesNotMatch(
      rewriteHindiQuantityWordsForEnglishSpeech('call at do baje'),
      /do baje/i,
    );
  });

  it('rewrites bare das to ten', () => {
    assert.equal(rewriteHindiQuantityWordsForEnglishSpeech('around das'), 'around ten');
  });

  it('prepareEnglishLockSpeech does clocks and Hindi quantities', () => {
    const out = prepareEnglishLockSpeech('Meet at 1:30 PM, budget das lakh');
    assert.doesNotMatch(out, /:/);
    assert.match(out, /one thirty PM/i);
    assert.match(out, /ten lakh/i);
    assert.doesNotMatch(out, /\bdas\b/i);
    assert.doesNotMatch(out, /baje/i);
  });
});

describe('formatSpokenSlotAlternative', () => {
  it('formats ISO starts without a colon', () => {
    // Tuesday 4 Aug 2026 13:00 IST = 4 Aug 2026 07:30 UTC
    const spoken = formatSpokenSlotAlternative('2026-08-04T07:30:00.000Z', 'en');
    assert.doesNotMatch(spoken, /:/);
    assert.match(spoken, /1 PM/);
    assert.match(spoken, /Tuesday|4 August|August/);
  });

  it('joins alternatives without colons', () => {
    const joined = formatSpokenSlotAlternatives(
      [
        { start: '2026-08-04T07:30:00.000Z' }, // 1:00 PM IST
        { start: '2026-08-04T08:15:00.000Z' }, // 1:45 PM IST
        { start: '2026-08-04T09:00:00.000Z' }, // 2:30 PM IST
      ],
      'en',
    );
    assert.doesNotMatch(joined, /:/);
    assert.match(joined, /1 PM/);
    assert.match(joined, /one forty-five PM/);
    assert.match(joined, /two thirty PM/);
  });
});

describe('rewriteRahiForSpeech', () => {
  it('rewrites bol rahi hoon to bol rehi hoon', () => {
    assert.equal(
      rewriteRahiForSpeech(
        'Good morning, Volkswagen India se Neha bol rahi hoon.',
      ),
      'Good morning, Volkswagen India se Neha bol rehi hoon.',
    );
  });

  it('does not change Rahim or already-rewritten rehi', () => {
    assert.equal(rewriteRahiForSpeech('Rahim bol rehi hoon'), 'Rahim bol rehi hoon');
  });
});
