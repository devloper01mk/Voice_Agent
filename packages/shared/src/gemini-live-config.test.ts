import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGeminiLiveS2sInstructionSupplement } from './gemini-live-config.js';
import { VERTICAL_PACKS } from './packs/index.js';

describe('buildGeminiLiveS2sInstructionSupplement', () => {
  it('adds tool-first lookup rules from the hotel pack', () => {
    const text = buildGeminiLiveS2sInstructionSupplement(
      'Kore',
      'gemini-3.8-live',
      VERTICAL_PACKS.hotel_stay.s2sRules,
    );
    assert.match(text, /TOOL-FIRST/i);
    assert.match(text, /ZERO spoken audio/i);
    assert.match(text, /That means check-in/i);
    assert.doesNotMatch(text, /ALREADY SPOKEN/i);
    assert.match(text, /never silent/i);
    assert.match(text, /bataiye is not a city/i);
    assert.match(text, /never audio-confirm dates before the tool/i);
  });

  it('keeps the core supplement free of hotel / dealership wording', () => {
    const text = buildGeminiLiveS2sInstructionSupplement('Kore', 'gemini-3.8-live');
    assert.doesNotMatch(text, /hotel|check-in|dealership|Manali/i);
    assert.match(text, /search_product_knowledge/);
    assert.match(text, /Answer first \(critical\)/i);
    assert.match(text, /Remember this call/i);
    assert.match(text, /Yes is not a place/i);
    assert.match(text, /exactly 10 digits/i);
    assert.match(text, /do NOT agree/i);
    assert.match(text, /One voice \(critical\)/i);
    assert.match(text, /Long call \(critical\)/i);
    assert.match(text, /Recommend, do not dump/i);
    assert.match(text, /finish every sentence/i);
    assert.match(text, /thank you, bye, or bas/i);
    assert.match(text, /Never speak tool names/i);
    assert.match(text, /Confirmed facts only/i);
    assert.match(text, /Price only when asked/i);
    assert.match(text, /Answer only that question/i);
    assert.match(text, /First offer 5%/i);
    assert.match(text, /20% is the last step/i);
    assert.match(text, /never announce the maximum/i);
  });
});
