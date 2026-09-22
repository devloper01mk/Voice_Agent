import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAngryCallerSystemNote,
  buildDeferBookingSystemNote,
  buildSalesSupportSkillsPrompt,
  isClearBookIntent,
  isDeferBookingAsk,
  isFrustratedOrAngryTurn,
  mergeSkillsConfig,
} from './index.js';

describe('sales-support-skills', () => {
  it('detects defer-booking corrections in Hinglish and Devanagari', () => {
    assert.equal(
      isDeferBookingAsk('Aap hamesha booking par kyun chale jate ho? Pehle bata to do'),
      true,
    );
    assert.equal(isDeferBookingAsk('बुकिंग से पहले मेरे को फैसिलिटी बताओ'), true);
    assert.equal(isDeferBookingAsk('Agra mein hotel hai kya?'), false);
    assert.equal(isDeferBookingAsk('Haan book kar do'), false);
  });

  it('detects clear book intent and frustrated turns', () => {
    assert.equal(isClearBookIntent('Haan booking kar do'), true);
    assert.equal(isClearBookIntent('Facilities kya hain?'), false);
    assert.equal(isFrustratedOrAngryTurn('Bahut gussa aa raha hai'), true);
    assert.equal(isFrustratedOrAngryTurn('Price kya hai?'), false);
  });

  it('builds defer and angry system notes', () => {
    assert.match(buildDeferBookingSystemNote(), /do NOT pitch booking/i);
    assert.match(
      buildAngryCallerSystemNote('Samajh sakti hoon', 'Simple rakhti hoon'),
      /frustrated or angry/i,
    );
  });

  it('injects Studio skills into the compiled-style skills prompt', () => {
    const skills = mergeSkillsConfig(null);
    const block = buildSalesSupportSkillsPrompt(skills, 'Moustache Escapes', 'Kavya', 'female');
    assert.match(block, /## Sales & support skills/);
    assert.match(block, /Product Knowledge \/ Brain/);
    assert.match(block, /Angry \/ frustrated — acknowledge/);
    assert.match(block, /Answer-first lock/);
    assert.doesNotMatch(block, /1\. ANGRY \/ FRUSTRATED/);
  });
});
