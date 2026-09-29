import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inrToEnglishWords, spokenIntakeCorrection, spokenToolLeakLine } from './spoken-intake-guard.js';

describe('spokenIntakeCorrection', () => {
  it('tells the caller a 9-digit mobile is short', () => {
    const line = spokenIntakeCorrection({
      language: 'en',
      bookingSaved: false,
      userTurns: ['So my name is Chitran Kumar Jain and my number is 977663332.'],
      assistantTurns: ['The total is 181,773 rupees.'],
      assistantText: 'I will share a secure payment link with you shortly.',
    });
    assert.match(line ?? '', /9 digits/);
    assert.match(line ?? '', /10 digits/);
  });

  it('reads the name back before a save when the number is already 10 digits', () => {
    const line = spokenIntakeCorrection({
      language: 'en',
      bookingSaved: false,
      userTurns: ['My name is Chitran Kumar Jain and my number is 9776633322.'],
      assistantTurns: [],
      assistantText: 'Your booking is confirmed. I will share a payment link.',
    });
    assert.match(line ?? '', /Chitran Kumar Jain/);
    assert.match(line ?? '', /read the name back/i);
  });

  it('refuses a lakh total the caller shortened to thousands', () => {
    const line = spokenIntakeCorrection({
      language: 'en',
      bookingSaved: false,
      userTurns: ['Okay, so it will be 18173.'],
      assistantTurns: ['The total cost is 181,773 rupees.'],
      assistantText: 'Yes, that is the total amount for your stay.',
    });
    assert.match(line ?? '', /not the same total/i);
    assert.match(line ?? '', /one lakh eighty-one thousand/i);
  });

  it('stays quiet after a real save', () => {
    assert.equal(
      spokenIntakeCorrection({
        language: 'en',
        bookingSaved: true,
        userTurns: ['my number is 977663332'],
        assistantTurns: [],
        assistantText: 'Your booking is confirmed.',
      }),
      null,
    );
  });
});

describe('spokenToolLeakLine', () => {
  it('replaces a spoken tool name with a human stay-on-the-line line', () => {
    const line = spokenToolLeakLine(
      'The booking was successfully made, and the capture_demo_lead confirmed it. Then invoke end_call.',
      'en',
      true,
    );
    assert.match(line ?? '', /WhatsApp/);
    assert.match(line ?? '', /still here/);
    assert.equal(spokenToolLeakLine('Your stay is saved.', 'en'), null);
    const early = spokenToolLeakLine('Zaroor! Kaunsi city? (Call initiated: lookup_hotel_availability)', 'en', false);
    assert.match(early ?? '', /not meant for you/i);
    assert.doesNotMatch(early ?? '', /hang up|WhatsApp/i);
  });
});

describe('inrToEnglishWords', () => {
  it('speaks 181773 as lakhs', () => {
    assert.equal(
      inrToEnglishWords(181773),
      'one lakh eighty-one thousand seven hundred seventy-three',
    );
  });
});
